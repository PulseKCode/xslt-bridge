<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="text"/>
<xsl:template match="/"><xsl:for-each select="r/i"><xsl:sort case-order="upper-first" lang="en"/><xsl:value-of select="."/></xsl:for-each>|<xsl:for-each select="r/i"><xsl:sort case-order="lower-first"/><xsl:value-of select="."/></xsl:for-each></xsl:template></xsl:stylesheet>