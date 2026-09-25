<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="text"/>
<xsl:template match="/"><xsl:apply-templates><xsl:with-param name="p" select="'passed'"/></xsl:apply-templates></xsl:template>
<xsl:template match="a"><xsl:param name="p" select="'default'"/><xsl:value-of select="$p"/></xsl:template></xsl:stylesheet>