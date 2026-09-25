<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="xml" omit-xml-declaration="yes"/>
<xsl:template match="/"><o at="{r/@a}" q="&quot;&apos;&lt;&gt;&amp;"><xsl:value-of select="r"/>|<xsl:value-of select="r/@a"/>]]&gt;</o></xsl:template></xsl:stylesheet>