<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="text"/>
<xsl:key name="byOwner" match="part" use="owner"/>
<xsl:key name="byType" match="part" use="@type"/>
<xsl:key name="attrKey" match="@state" use="."/>
<xsl:template match="/">
<xsl:for-each select="//part[generate-id() = generate-id(key('byOwner', owner)[1])]"><xsl:value-of select="owner"/>:<xsl:value-of select="count(key('byOwner', owner))"/>;</xsl:for-each>|<xsl:value-of select="count(key('byType', 'Mechanical'))"/>|<xsl:value-of select="count(key('attrKey', 'RELEASED'))"/>|<xsl:for-each select="key('byType', //part/@type)"><xsl:value-of select="@id"/>,</xsl:for-each>
</xsl:template></xsl:stylesheet>