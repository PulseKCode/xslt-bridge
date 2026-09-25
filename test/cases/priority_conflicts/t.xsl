<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:x="urn:x">
<xsl:output method="text"/>
<xsl:template match="/r"><xsl:apply-templates select="*"/>|<xsl:apply-templates select="*" mode="m"/></xsl:template>
<xsl:template match="*">[any]</xsl:template>
<xsl:template match="item">[item1]</xsl:template>
<xsl:template match="item">[item2]</xsl:template>
<xsl:template match="x:*">[x-any]</xsl:template>
<xsl:template match="node()" mode="m">[node]</xsl:template>
<xsl:template match="//item" mode="m">[dslash]</xsl:template>
<xsl:template match="r/item" mode="m">[path]</xsl:template></xsl:stylesheet>