<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="xml" omit-xml-declaration="yes"/>
<xsl:strip-space elements="r"/>
<xsl:template match="/r"><out n="{count(node())}">
  <xsl:for-each select="v"><xsl:if test="normalize-space(.)"><yes/></xsl:if><xsl:choose><xsl:when test=". &gt; 2">big</xsl:when><xsl:when test=". &gt; 1">mid</xsl:when><xsl:otherwise>none</xsl:otherwise></xsl:choose></xsl:for-each>
  <xsl:text>  keep  </xsl:text>
  <sp xml:space="preserve">  <xsl:value-of select="'x'"/>  </sp>
  <w len="{string-length(w)}"/>
</out></xsl:template></xsl:stylesheet>