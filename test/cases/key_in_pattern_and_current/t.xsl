<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="text"/>
<xsl:key name="k" match="r" use="@s"/>
<xsl:template match="/"><xsl:apply-templates select="//r"/>|<xsl:for-each select="//r"><xsl:value-of select="count(//r[@s = current()/@s])"/></xsl:for-each>|<xsl:for-each select="//n"><xsl:value-of select="../@id"/><xsl:value-of select="name(..)"/>;</xsl:for-each></xsl:template>
<xsl:template match="key('k','A')">[A<xsl:value-of select="@id"/>]</xsl:template>
<xsl:template match="r">[other<xsl:value-of select="@id"/>]</xsl:template></xsl:stylesheet>