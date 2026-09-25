<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns="http://www.w3.org/1999/xhtml" xmlns:a="urn:a" xmlns:b="urn:b" exclude-result-prefixes="b">
<xsl:output method="xml" omit-xml-declaration="yes"/>
<xsl:template match="/"><html><body><a:x><p>t</p></a:x><xsl:call-template name="t2"/></body></html></xsl:template>
<xsl:template name="t2"><div xmlns:c="urn:c" class="k"><c:y/></div><span xmlns=""><i/></span></xsl:template></xsl:stylesheet>