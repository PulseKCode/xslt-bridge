<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html"/>
<xsl:template match="/"><div><xsl:value-of select="r/h" disable-output-escaping="yes"/>|<xsl:value-of select="r/h"/>|<xsl:text disable-output-escaping="yes">&amp;nbsp;</xsl:text><span title="a&quot;b&apos;c&lt;&amp;&gt;">q "x" 'y' &amp;amp;</span></div></xsl:template></xsl:stylesheet>