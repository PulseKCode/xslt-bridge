<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="text"/>
<xsl:template match="/"><xsl:apply-templates select="//p|//sec"/>
<xsl:number value="1234567" grouping-separator="," grouping-size="3"/>|<xsl:number value="28" format="A"/>|<xsl:number value="28" format="a"/>|<xsl:number value="1999" format="I"/>|<xsl:number value="4" format="i"/>|<xsl:number value="7" format="001"/>|<xsl:number value="2.5"/>|<xsl:number value="0" format="a"/>|<xsl:number value="3" format="(1)"/>|<xsl:number value="-3"/>
</xsl:template>
<xsl:template match="sec">[s:<xsl:number/>/<xsl:number level="multiple" count="ch|sec" format="1.1"/>/<xsl:number level="any"/>]</xsl:template>
<xsl:template match="p">[p:<xsl:number level="multiple" count="ch|sec|p" format="1.a.i"/>|<xsl:number level="any" from="ch"/>]</xsl:template></xsl:stylesheet>