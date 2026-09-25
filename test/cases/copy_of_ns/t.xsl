<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="xml" indent="no"/>
<xsl:template match="/"><out><xsl:copy-of select="/*/*"/><xsl:copy-of select="/"/></out></xsl:template></xsl:stylesheet>