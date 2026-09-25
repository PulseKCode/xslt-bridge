<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="text"/>
<xsl:template match="/"><a>A<b>B</b></a><!--c-->C<xsl:value-of select="'&lt;&amp;'"/></xsl:template></xsl:stylesheet>