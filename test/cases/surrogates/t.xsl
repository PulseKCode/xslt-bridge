<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="text"/>
<xsl:template match="/"><xsl:value-of select="string-length(r)"/>|<xsl:value-of select="substring(r, 2, 1)"/>|<xsl:value-of select="translate(r, '😀', 'X')"/>|<xsl:value-of select="substring-after(r, '😀')"/></xsl:template></xsl:stylesheet>