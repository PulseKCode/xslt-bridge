<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="xml" omit-xml-declaration="yes"/>
<xsl:template match="/"><o><xsl:attribute name="a">1</xsl:attribute>text<xsl:attribute name="b">2</xsl:attribute><e><xsl:copy-of select="//r[1]/@*"/></e></o></xsl:template></xsl:stylesheet>