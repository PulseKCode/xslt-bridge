<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="text"/>
<xsl:variable name="r"><a>1</a><a>2</a></xsl:variable>
<xsl:variable name="n">42</xsl:variable>
<xsl:template match="/"><xsl:value-of select="count($r)"/>|<xsl:value-of select="sum($n)"/>|<xsl:value-of select="string($r)"/>|<xsl:value-of select="$n + 1"/>|<xsl:value-of select="boolean($r)"/>|<xsl:value-of select="$r = '12'"/></xsl:template></xsl:stylesheet>