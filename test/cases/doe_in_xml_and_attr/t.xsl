<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="xml" omit-xml-declaration="yes"/>
<xsl:template match="/"><o><xsl:value-of select="r" disable-output-escaping="yes"/><xsl:value-of select="r"/><e><xsl:attribute name="a"><xsl:value-of select="r" disable-output-escaping="yes"/></xsl:attribute></e></o></xsl:template></xsl:stylesheet>