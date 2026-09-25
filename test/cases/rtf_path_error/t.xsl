<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="text"/>
<xsl:variable name="r"><a>1</a><a>2</a></xsl:variable>
<xsl:template match="/"><xsl:value-of select="count($r/a)"/></xsl:template></xsl:stylesheet>