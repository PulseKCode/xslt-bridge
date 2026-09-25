/*
 * blinkxslt - reference transformer used to generate the expected outputs of the test suite.
 *
 * It drives libxslt/libxml2 the same way Chrome's XSLTProcessor does
 * (third_party/blink/renderer/core/xml/xslt_processor_libxslt.cc):
 *   - omit-xml-declaration is forced, a single trailing newline is removed from the result,
 *   - with --html the output method defaults to "html" when the stylesheet declares none
 *     (transformToFragment() into an HTML document),
 *   - only exsl:node-set is registered as an extension function; the built-in multi-document
 *     extension elements are unregistered,
 *   - text sorting uses ICU collation (locale "en" unless xsl:sort/@lang is given, upper-first).
 * xsltRegisterAllExtras() / exsltRegisterAll() are intentionally NOT called, like in Chrome.
 *
 * Usage: blinkxslt [--html] [--param name value]... stylesheet.xsl input.xml
 * The result is written to stdout; the result MIME type is printed on the last line of stderr.
 *
 * UnicodeSort() is adapted from Chromium's xslt_unicode_sort.cc:
 *   Copyright (C) 2007, 2008, 2009 Apple Inc. All rights reserved. (BSD-style license,
 *   reproduced in THIRD-PARTY-NOTICES.md)
 * ExsltNodeSetFunction() is adapted from Chromium's xslt_extensions.cc:
 *   Copyright (C) 2001-2002 Thomas Broyer, Charlie Bozeman and Daniel Veillard.
 *   Copyright (C) 2007 Alexey Proskuryakov <ap@webkit.org> (MIT-style license,
 *   reproduced in THIRD-PARTY-NOTICES.md)
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <libxml/parser.h>
#include <libxml/xpathInternals.h>
#include <libxslt/xslt.h>
#include <libxslt/xsltInternals.h>
#include <libxslt/transform.h>
#include <libxslt/xsltutils.h>
#include <libxslt/extensions.h>
#include <libxslt/extra.h>
#include <libxslt/variables.h>
#include <libxslt/security.h>
#include <libxslt/templates.h>
#include <libxslt/imports.h>

/* ICU C API (declared here so that ICU headers are not required; adjust the _74 suffix to your ICU version) */
typedef struct UCollator UCollator;
typedef int UErrorCode;
extern UCollator *ucol_open_74(const char *loc, UErrorCode *status);
extern void ucol_setAttribute_74(UCollator *coll, int attr, int value, UErrorCode *status);
extern int ucol_strcollUTF8_74(const UCollator *coll, const char *s, int32_t sl, const char *t, int32_t tl, UErrorCode *status);
extern void ucol_close_74(UCollator *coll);
#define UCOL_CASE_FIRST 2
#define UCOL_NORMALIZATION_MODE 4
#define UCOL_ON 17
#define UCOL_LOWER_FIRST 24
#define UCOL_UPPER_FIRST 25

/* Same settings as Blink: ucol_open(lang) with root fallback, CASE_FIRST, NORMALIZATION_MODE ON */
static UCollator *open_collator(const char *locale, int lower_first) {
  UErrorCode st = 0;
  UCollator *c = ucol_open_74(locale, &st);
  if (st > 0) { st = 0; c = ucol_open_74("", &st); }
  st = 0; ucol_setAttribute_74(c, UCOL_CASE_FIRST, lower_first ? UCOL_LOWER_FIRST : UCOL_UPPER_FIRST, &st);
  st = 0; ucol_setAttribute_74(c, UCOL_NORMALIZATION_MODE, UCOL_ON, &st);
  return c;
}
static int collate(UCollator *c, const xmlChar *a, const xmlChar *b) {
  UErrorCode st = 0;
  return ucol_strcollUTF8_74(c, (const char *)a, -1, (const char *)b, -1, &st);
}

/* Adapted from Blink xslt_unicode_sort.cc XsltUnicodeSortFunction */
static void UnicodeSort(xsltTransformContextPtr ctxt, xmlNodePtr *sorts, int nbsorts) {
  xsltStylePreCompPtr comp;
  xmlXPathObjectPtr *results_tab[XSLT_MAX_SORT];
  xmlXPathObjectPtr *results = NULL;
  xmlNodeSetPtr list = NULL;
  int depth, j, i, incr, len, descending, number;
  xmlNodePtr node;
  int tempstype[XSLT_MAX_SORT], temporder[XSLT_MAX_SORT];
  UCollator *collator;

  if (!ctxt || !sorts || nbsorts <= 0 || nbsorts >= XSLT_MAX_SORT) return;
  if (!sorts[0]) return;
  comp = (xsltStylePreCompPtr)sorts[0]->psvi;
  if (!comp) return;
  list = ctxt->nodeList;
  if (!list || list->nodeNr <= 1) return;

  for (j = 0; j < nbsorts; ++j) {
    comp = (xsltStylePreCompPtr)sorts[j]->psvi;
    tempstype[j] = 0;
    if (!comp->stype && comp->has_stype) {
      comp->stype = xsltEvalAttrValueTemplate(ctxt, sorts[j], (const xmlChar *)"data-type", XSLT_NAMESPACE);
      if (comp->stype) {
        tempstype[j] = 1;
        if (xmlStrEqual(comp->stype, (const xmlChar *)"text")) comp->number = 0;
        else if (xmlStrEqual(comp->stype, (const xmlChar *)"number")) comp->number = 1;
        else {
          xsltTransformError(ctxt, NULL, sorts[j], "xsltDoSortFunction: no support for data-type = %s\n", comp->stype);
          comp->number = 0;
        }
      }
    }
    temporder[j] = 0;
    if (!comp->order && comp->has_order) {
      comp->order = xsltEvalAttrValueTemplate(ctxt, sorts[j], (const xmlChar *)"order", XSLT_NAMESPACE);
      if (comp->order) {
        temporder[j] = 1;
        if (xmlStrEqual(comp->order, (const xmlChar *)"ascending")) comp->descending = 0;
        else if (xmlStrEqual(comp->order, (const xmlChar *)"descending")) comp->descending = 1;
        else {
          xsltTransformError(ctxt, NULL, sorts[j], "xsltDoSortFunction: invalid value %s for order\n", comp->order);
          comp->descending = 0;
        }
      }
    }
  }
  len = list->nodeNr;
  results_tab[0] = xsltComputeSortResult(ctxt, sorts[0]);
  for (i = 1; i < XSLT_MAX_SORT; ++i) results_tab[i] = NULL;
  results = results_tab[0];
  comp = (xsltStylePreCompPtr)sorts[0]->psvi;
  descending = comp->descending;
  number = comp->number;
  if (!results) return;

  collator = open_collator(comp->has_lang ? (const char *)comp->lang : "en", comp->lower_first);

  for (incr = len / 2; incr > 0; incr /= 2) {
    for (i = incr; i < len; ++i) {
      j = i - incr;
      if (!results[i]) continue;
      while (j >= 0) {
        int tst;
        if (!results[j]) {
          tst = 1;
        } else {
          if (number) {
            if (xmlXPathIsNaN(results[j]->floatval)) {
              if (xmlXPathIsNaN(results[j + incr]->floatval)) tst = 0; else tst = -1;
            } else if (xmlXPathIsNaN(results[j + incr]->floatval)) tst = 1;
            else if (results[j]->floatval == results[j + incr]->floatval) tst = 0;
            else if (results[j]->floatval > results[j + incr]->floatval) tst = 1;
            else tst = -1;
          } else {
            tst = collate(collator, results[j]->stringval, results[j + incr]->stringval);
          }
          if (descending) tst = -tst;
        }
        if (tst == 0) {
          depth = 1;
          while (depth < nbsorts) {
            xmlXPathObjectPtr *res;
            int desc, numb;
            if (!sorts[depth]) break;
            comp = (xsltStylePreCompPtr)sorts[depth]->psvi;
            if (!comp) break;
            desc = comp->descending;
            numb = comp->number;
            if (!results_tab[depth]) results_tab[depth] = xsltComputeSortResult(ctxt, sorts[depth]);
            res = results_tab[depth];
            if (!res) break;
            if (!res[j]) {
              if (res[j + incr]) tst = 1;
            } else {
              if (numb) {
                if (xmlXPathIsNaN(res[j]->floatval)) {
                  if (xmlXPathIsNaN(res[j + incr]->floatval)) tst = 0; else tst = -1;
                } else if (xmlXPathIsNaN(res[j + incr]->floatval)) tst = 1;
                else if (res[j]->floatval == res[j + incr]->floatval) tst = 0;
                else if (res[j]->floatval > res[j + incr]->floatval) tst = 1;
                else tst = -1;
              } else {
                tst = collate(collator, res[j]->stringval, res[j + incr]->stringval);
              }
              if (desc) tst = -tst;
            }
            if (tst != 0) break;
            depth++;
          }
        }
        if (tst == 0) tst = results[j]->index > results[j + incr]->index;
        if (tst > 0) {
          xmlXPathObjectPtr tmp = results[j];
          results[j] = results[j + incr];
          results[j + incr] = tmp;
          node = list->nodeTab[j];
          list->nodeTab[j] = list->nodeTab[j + incr];
          list->nodeTab[j + incr] = node;
          depth = 1;
          while (depth < nbsorts) {
            xmlXPathObjectPtr *res;
            if (!sorts[depth]) break;
            if (!results_tab[depth]) break;
            res = results_tab[depth];
            tmp = res[j];
            res[j] = res[j + incr];
            res[j + incr] = tmp;
            depth++;
          }
          j -= incr;
        } else break;
      }
    }
  }
  ucol_close_74(collator);
  for (j = 0; j < nbsorts; ++j) {
    comp = (xsltStylePreCompPtr)sorts[j]->psvi;
    if (tempstype[j] == 1) { xmlFree((void *)comp->stype); comp->stype = NULL; }
    if (temporder[j] == 1) { xmlFree((void *)comp->order); comp->order = NULL; }
    if (results_tab[j]) {
      for (i = 0; i < len; ++i) xmlXPathFreeObject(results_tab[j][i]);
      xmlFree(results_tab[j]);
    }
  }
}

/* Adapted from Blink xslt_extensions.cc ExsltNodeSetFunction */
static void ExsltNodeSetFunction(xmlXPathParserContextPtr ctxt, int nargs) {
  xmlChar *strval;
  xmlNodePtr ret_node;
  xmlXPathObjectPtr ret;
  xsltTransformContextPtr tctxt;
  xmlDocPtr fragment;
  if (nargs != 1) { xmlXPathSetArityError(ctxt); return; }
  if (xmlXPathStackIsNodeSet(ctxt)) { xsltFunctionNodeSet(ctxt, nargs); return; }
  tctxt = xsltXPathGetTransformContext(ctxt);
  fragment = xsltCreateRVT(tctxt);
  xsltRegisterLocalRVT(tctxt, fragment);
  strval = xmlXPathPopString(ctxt);
  ret_node = xmlNewDocText(fragment, strval);
  xmlAddChild((xmlNodePtr)fragment, ret_node);
  ret = xmlXPathNewNodeSet(ret_node);
  if (strval) xmlFree(strval);
  xmlXPathValuePush(ctxt, ret);
}

int main(int argc, char **argv) {
  int force_html = 0, np = 0, i = 1;
  const char *params[128];
  const char *xsl_path, *xml_path;
  xmlDocPtr sdoc, doc, res;
  xsltStylesheetPtr sheet;
  xsltTransformContextPtr ctxt;
  xsltSecurityPrefsPtr sec;
  xmlChar *orig_method;
  const xmlChar *rt = NULL;
  const char *mime;
  int rv;

  /* Blink InitializeLibXSLT(): unregister the built-in multi-document extension elements */
  xsltInit();
  xsltUnregisterExtModuleElement((const xmlChar *)"debug", XSLT_LIBXSLT_NAMESPACE);
  xsltUnregisterExtModuleElement((const xmlChar *)"output", XSLT_SAXON_NAMESPACE);
  xsltUnregisterExtModuleElement((const xmlChar *)"write", XSLT_XALAN_NAMESPACE);
  xsltUnregisterExtModuleElement((const xmlChar *)"document", XSLT_XT_NAMESPACE);
  xsltUnregisterExtModuleElement((const xmlChar *)"document", XSLT_NAMESPACE);

  for (; i < argc; i++) {
    if (!strcmp(argv[i], "--html")) force_html = 1;
    else if (!strcmp(argv[i], "--param") && i + 2 < argc) { params[np++] = argv[i + 1]; params[np++] = argv[i + 2]; i += 2; }
    else break;
  }
  if (argc - i != 2) { fprintf(stderr, "usage\n"); return 2; }
  xsl_path = argv[i]; xml_path = argv[i + 1];
  params[np] = NULL;

  sdoc = xmlReadFile(xsl_path, NULL, XML_PARSE_NOENT | XML_PARSE_DTDATTR | XML_PARSE_NOWARNING | XML_PARSE_NOCDATA);
  if (!sdoc) { fprintf(stderr, "STYLE_PARSE_FAIL\n"); return 5; }
  sheet = xsltParseStylesheetDoc(sdoc);
  if (!sheet || sheet->errors) { fprintf(stderr, "COMPILE_FAIL\n"); return 5; }
  doc = xmlReadFile(xml_path, NULL, XSLT_PARSE_OPTIONS);
  if (!doc) { fprintf(stderr, "SOURCE_PARSE_FAIL\n"); return 6; }

  orig_method = sheet->method;
  if (!orig_method && force_html) sheet->method = (xmlChar *)"html";
  sheet->omitXmlDeclaration = 1;

  ctxt = xsltNewTransformContext(sheet, doc);
  xsltRegisterExtFunction(ctxt, (const xmlChar *)"node-set", (const xmlChar *)"http://exslt.org/common", ExsltNodeSetFunction);
  sec = xsltNewSecurityPrefs();
  xsltSetSecurityPrefs(sec, XSLT_SECPREF_WRITE_FILE, xsltSecurityForbid);
  xsltSetSecurityPrefs(sec, XSLT_SECPREF_CREATE_DIRECTORY, xsltSecurityForbid);
  xsltSetSecurityPrefs(sec, XSLT_SECPREF_WRITE_NETWORK, xsltSecurityForbid);
  xsltSetCtxtSecurityPrefs(sec, ctxt);
  xsltSetCtxtSortFunc(ctxt, UnicodeSort);
  if (!ctxt->globalVars) ctxt->globalVars = xmlHashCreate(20);
  xsltQuoteUserParams(ctxt, np ? params : NULL);
  res = xsltApplyStylesheetUser(sheet, doc, NULL, NULL, NULL, ctxt);
  xsltFreeTransformContext(ctxt);
  xsltFreeSecurityPrefs(sec);
  if (!res) { sheet->method = orig_method; fprintf(stderr, "RUNTIME_FAIL\n"); return 9; }

  {
    xmlOutputBufferPtr buf = xmlAllocOutputBuffer(NULL);
    const xmlChar *content;
    size_t size;
    rv = xsltSaveResultTo(buf, res, sheet);
    xmlOutputBufferFlush(buf);
    content = xmlOutputBufferGetContent(buf);
    size = xmlOutputBufferGetSize(buf);
    if (rv < 0) { fprintf(stderr, "SAVE_FAIL\n"); return 9; }
    if (size > 0 && content[size - 1] == '\n') size--;   /* Blink: drop one trailing newline */
    fwrite(content, 1, size, stdout);
    xmlOutputBufferClose(buf);
  }
  XSLT_GET_IMPORT_PTR(rt, sheet, method);
  if (!rt && res->type == XML_HTML_DOCUMENT_NODE) rt = (const xmlChar *)"html";
  mime = xmlStrEqual(rt, (const xmlChar *)"html") ? "text/html" : (xmlStrEqual(rt, (const xmlChar *)"text") ? "text/plain" : "application/xml");
  fprintf(stderr, "MIME:%s\n", mime);
  sheet->method = orig_method;
  return 0;
}
