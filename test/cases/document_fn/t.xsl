<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="text"/>
<xsl:variable name="lookup" select="document('lookup.xml')/map"/>
<xsl:template match="/"><xsl:for-each select="//part"><xsl:value-of select="@id"/>=<xsl:value-of select="$lookup/e[@k=current()/@type]"/>;</xsl:for-each>|<xsl:value-of select="count(document('')//xsl:template)"/></xsl:template></xsl:stylesheet>