<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="text"/>
<xsl:variable name="b" select="number(/r/v)"/>
<xsl:template match="/"><xsl:variable name="b" select="100"/><xsl:value-of select="$b"/>|<xsl:call-template name="t"/></xsl:template>
<xsl:template name="t"><xsl:value-of select="$b"/></xsl:template></xsl:stylesheet>