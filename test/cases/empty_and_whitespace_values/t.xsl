<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="xml" omit-xml-declaration="yes"/>
<xsl:template match="/"><o a="{r/e}" b="{r/w}"><xsl:value-of select="r/e"/><x><xsl:value-of select="r/w"/></x><y><xsl:value-of select="''" disable-output-escaping="yes"/></y><xsl:text/></o></xsl:template></xsl:stylesheet>