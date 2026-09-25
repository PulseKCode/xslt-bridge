<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html" indent="no"/>
<xsl:template match="/">
<div id="freeze"><table><tbody><xsl:apply-templates select="parts/part"/></tbody></table></div>
</xsl:template>
<xsl:template match="part"><tr><td><xsl:value-of select="position()"/>/<xsl:value-of select="last()"/></td><td><xsl:value-of select="name"/></td></tr></xsl:template></xsl:stylesheet>