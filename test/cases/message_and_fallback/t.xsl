<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:ext="urn:unknown-ext" extension-element-prefixes="ext">
<xsl:output method="text"/>
<xsl:template match="/"><xsl:message>hello</xsl:message>A<ext:thing><xsl:fallback>FB</xsl:fallback></ext:thing>B</xsl:template></xsl:stylesheet>