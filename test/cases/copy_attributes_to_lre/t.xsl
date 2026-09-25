<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="xml" omit-xml-declaration="yes"/>
<xsl:template match="/r"><out><xsl:copy-of select="@*"/><xsl:for-each select="@*"><xsl:copy/></xsl:for-each><inner><xsl:apply-templates select="s/@x"/></inner><xsl:copy-of select="s"/></out></xsl:template>
<xsl:template match="@x"><xsl:attribute name="renamed"><xsl:value-of select="."/></xsl:attribute></xsl:template></xsl:stylesheet>