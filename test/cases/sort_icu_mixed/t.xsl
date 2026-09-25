<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:output method="text"/>
<xsl:template match="/"><xsl:for-each select="r/i"><xsl:sort/>[<xsl:value-of select="."/>]</xsl:for-each>
D:<xsl:for-each select="r/i"><xsl:sort order="descending"/>[<xsl:value-of select="."/>]</xsl:for-each>
L:<xsl:for-each select="r/i"><xsl:sort case-order="lower-first"/>[<xsl:value-of select="."/>]</xsl:for-each>
K:<xsl:for-each select="r/i"><xsl:sort lang="ko"/>[<xsl:value-of select="."/>]</xsl:for-each>
U:<xsl:for-each select="r/i"><xsl:sort lang="en_US" case-order="upper-first"/>[<xsl:value-of select="."/>]</xsl:for-each></xsl:template></xsl:stylesheet>