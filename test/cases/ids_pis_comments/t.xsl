<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="text"/>
<xsl:template match="/"><xsl:value-of select="id('k1')"/>|<xsl:value-of select="count(//processing-instruction('target'))"/>|<xsl:value-of select="//processing-instruction()"/>|<xsl:value-of select="//comment()"/>|<xsl:value-of select="count(//a[lang('en')])"/>|<xsl:value-of select="count(//b[lang('en')])"/>|<xsl:value-of select="count(//node())"/>|<xsl:apply-templates select="//comment() | //processing-instruction()"/></xsl:template>
<xsl:template match="comment()">[C<xsl:value-of select="."/>]</xsl:template>
<xsl:template match="processing-instruction('target')">[P<xsl:value-of select="name()"/>]</xsl:template></xsl:stylesheet>