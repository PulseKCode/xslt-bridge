<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:include href="out.xsl"/>
<xsl:template match="/"><r><xsl:value-of select="count(//r)"/></r></xsl:template></xsl:stylesheet>