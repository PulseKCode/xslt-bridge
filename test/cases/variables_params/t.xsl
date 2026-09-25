<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="xml" omit-xml-declaration="yes"/>
<xsl:param name="mode" select="'full'"/>
<xsl:param name="user"/>
<xsl:variable name="total" select="sum(//qty)"/>
<xsl:variable name="rtf"><x a="1">one</x><x a="2">two</x></xsl:variable>
<xsl:variable name="g2" select="$total * 2"/>
<xsl:template match="/"><r mode="{$mode}" user="{$user}" total="{$total}" g2="{$g2}" rtf="{$rtf}">
<xsl:call-template name="row"><xsl:with-param name="label" select="'L1'"/></xsl:call-template>
<xsl:call-template name="row"/>
<xsl:call-template name="fact"><xsl:with-param name="n" select="10"/></xsl:call-template>
<xsl:variable name="v1">abc</xsl:variable><xsl:variable name="v2" select="concat($v1, '-', $mode)"/><v><xsl:value-of select="$v2"/></v>
<xsl:copy-of select="$rtf"/><xsl:for-each select="//part[1]"><xsl:variable name="i" select="@id"/><p><xsl:value-of select="$i"/></p></xsl:for-each>
</r></xsl:template>
<xsl:template name="row"><xsl:param name="label" select="'default'"/><row><xsl:value-of select="$label"/></row></xsl:template>
<xsl:template name="fact"><xsl:param name="n"/><xsl:param name="acc" select="1"/><xsl:choose><xsl:when test="$n &lt;= 1"><f><xsl:value-of select="$acc"/></f></xsl:when><xsl:otherwise><xsl:call-template name="fact"><xsl:with-param name="n" select="$n - 1"/><xsl:with-param name="acc" select="$acc * $n"/></xsl:call-template></xsl:otherwise></xsl:choose></xsl:template></xsl:stylesheet>