<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:msxsl="urn:schemas-microsoft-com:xslt">
<xsl:output method="text"/><xsl:variable name="t"><a/></xsl:variable>
<xsl:template match="/"><xsl:value-of select="count(msxsl:node-set($t)/a)"/></xsl:template></xsl:stylesheet>