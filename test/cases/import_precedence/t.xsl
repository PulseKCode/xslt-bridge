<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:import href="base.xsl"/>
<xsl:variable name="g" select="'main'"/>
<xsl:template match="r[@s='A']"><A><xsl:value-of select="$g"/><xsl:apply-imports/></A></xsl:template></xsl:stylesheet>