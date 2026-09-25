<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html"/>
<xsl:template match="/"><xsl:for-each select="//r"><xsl:element name="{concat('h', @id)}"><xsl:attribute name="{concat('data-', @s)}"><xsl:call-template name="lbl"/></xsl:attribute><xsl:value-of select="n"/></xsl:element></xsl:for-each><xsl:element name="TD">u</xsl:element></xsl:template>
<xsl:template name="lbl">L<xsl:value-of select="@id"/></xsl:template></xsl:stylesheet>