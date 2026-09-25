<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="xml" omit-xml-declaration="yes"/>
<xsl:template match="/"><r>
<a><xsl:for-each select="//part"><xsl:sort select="@type"/><xsl:sort select="qty" data-type="number" order="descending"/><i t="{@type}" q="{qty}"/></xsl:for-each></a>
<b><xsl:for-each select="//part"><xsl:sort select="price" data-type="number"/><i p="{price}"/></xsl:for-each></b>
<c><xsl:for-each select="//part"><xsl:sort select="name"/><i n="{name}"/></xsl:for-each></c>
<d><xsl:apply-templates select="//part"><xsl:sort select="@id" order="descending"/></xsl:apply-templates></d>
</r></xsl:template>
<xsl:template match="part"><p pos="{position()}" id="{@id}"/></xsl:template></xsl:stylesheet>