<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="xml" omit-xml-declaration="yes" indent="yes"/>
<xsl:template match="/"><out><xsl:apply-templates select="parts/part"/><xsl:apply-templates select="parts/part" mode="short"/><xsl:apply-templates select="//qty"/></out></xsl:template>
<xsl:template match="part"><generic id="{@id}"/></xsl:template>
<xsl:template match="part[@state='RELEASED']"><released id="{@id}"/></xsl:template>
<xsl:template match="part[@type='Mechanical']" priority="0.4"><mech id="{@id}"/></xsl:template>
<xsl:template match="parts/part" mode="short"><s><xsl:value-of select="@id"/></s></xsl:template>
<xsl:template match="*" mode="short"><never/></xsl:template>
<xsl:template match="qty[. &gt; 10]"><big><xsl:apply-templates/></big></xsl:template>
<xsl:template match="text()"><t><xsl:value-of select="."/></t></xsl:template></xsl:stylesheet>