<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="xml" omit-xml-declaration="yes"/>
<xsl:strip-space elements="*"/>
<xsl:preserve-space elements="p"/>
<xsl:template match="/"><o><xsl:for-each select="//*"><e n="{name()}" k="{count(node())}"/></xsl:for-each></o></xsl:template></xsl:stylesheet>