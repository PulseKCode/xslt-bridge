<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:e="urn:example" exclude-result-prefixes="e">
<xsl:output method="xml" omit-xml-declaration="yes"/>
<xsl:attribute-set name="base"><xsl:attribute name="class">cell</xsl:attribute><xsl:attribute name="width">10</xsl:attribute></xsl:attribute-set>
<xsl:attribute-set name="wide" use-attribute-sets="base"><xsl:attribute name="width">100</xsl:attribute></xsl:attribute-set>
<xsl:template match="/"><out>
<xsl:element name="{name(/*)}"><xsl:attribute name="n"><xsl:value-of select="count(//part)"/></xsl:attribute><xsl:attribute name="n">2</xsl:attribute>body</xsl:element>
<xsl:element name="x:thing" namespace="urn:x"><xsl:attribute name="y:attr" namespace="urn:y">v</xsl:attribute><xsl:attribute name="z" namespace="urn:z">w</xsl:attribute></xsl:element>
<td xsl:use-attribute-sets="wide" width="5"/>
<xsl:element name="div" use-attribute-sets="base"/>
<e:kept/>
<xsl:comment> a comment </xsl:comment><xsl:processing-instruction name="xml-stylesheet">href="a.css"</xsl:processing-instruction>
</out></xsl:template></xsl:stylesheet>