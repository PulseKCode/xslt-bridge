<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:import href="imp.xsl"/>
<xsl:include href="inc.xsl"/>
<xsl:output method="xml" omit-xml-declaration="yes"/>
<xsl:template match="/"><r><xsl:apply-templates select="//part"/><xsl:call-template name="fromInc"/></r></xsl:template>
<xsl:template match="part[@type='Mechanical']"><main><xsl:apply-imports/></main></xsl:template></xsl:stylesheet>