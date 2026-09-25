<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="text"/>
<xsl:variable name="a" select="$b + 1"/>
<xsl:variable name="b" select="number(/r/v)"/>
<xsl:template match="/"><xsl:value-of select="$a"/>|<xsl:variable name="b" select="100"/><xsl:value-of select="$b"/>|<xsl:for-each select="r"><xsl:variable name="b" select="'inner'"/><xsl:value-of select="$b"/></xsl:for-each>|<xsl:call-template name="t"/></xsl:template>
<xsl:template name="t"><xsl:value-of select="$b"/></xsl:template></xsl:stylesheet>