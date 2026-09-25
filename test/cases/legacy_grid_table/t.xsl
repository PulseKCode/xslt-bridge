<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html" encoding="UTF-8"/>
<xsl:param name="sortCol" select="'1'"/>
<xsl:param name="timeStamp" select="'123'"/>
<xsl:variable name="dir" select="/gridRoot/setting[@name='sortDirection']"/>
<xsl:variable name="lower" select="'abcdefghijklmnopqrstuvwxyz'"/>
<xsl:variable name="upper" select="'ABCDEFGHIJKLMNOPQRSTUVWXYZ'"/>
<xsl:key name="colByName" match="column" use="@name"/>
<xsl:template match="/gridRoot">
  <table id="bodyTable" border="0" cellspacing="0" cellpadding="0" width="100%">
    <thead><tr><xsl:apply-templates select="columns/column" mode="head"/></tr></thead>
    <tbody>
      <xsl:for-each select="rows/r">
        <xsl:sort select="translate(c[number($sortCol)], $lower, $upper)" order="{$dir}"/>
        <tr id="{@id}" o="{@o}">
          <xsl:attribute name="class"><xsl:choose><xsl:when test="position() mod 2 = 0">even</xsl:when><xsl:otherwise>odd</xsl:otherwise></xsl:choose><xsl:if test="@disabled='true'"> disabled</xsl:if></xsl:attribute>
          <xsl:for-each select="c">
            <xsl:variable name="pos" select="position()"/>
            <xsl:variable name="col" select="/gridRoot/columns/column[$pos]"/>
            <td>
              <xsl:if test="$col/@width"><xsl:attribute name="width"><xsl:value-of select="$col/@width"/></xsl:attribute></xsl:if>
              <xsl:choose>
                <xsl:when test="$pos = 1">
                  <xsl:call-template name="indent"><xsl:with-param name="n" select="../@level"/></xsl:call-template>
                  <a href="javascript:openRow('{../@o}', '{$timeStamp}')" onclick="return showDetails('{translate(@a, &quot;'&quot;, &quot;`&quot;)}');"><xsl:value-of select="."/></a>
                </xsl:when>
                <xsl:when test="$col/@html='true'"><xsl:value-of select="." disable-output-escaping="yes"/></xsl:when>
                <xsl:when test="$col/@sortType='integer'"><xsl:value-of select="format-number(., '#,##0')"/></xsl:when>
                <xsl:otherwise><xsl:value-of select="."/><xsl:if test="not(normalize-space(.))">&#160;</xsl:if></xsl:otherwise>
              </xsl:choose>
            </td>
          </xsl:for-each>
        </tr>
      </xsl:for-each>
    </tbody>
    <tfoot><tr><td colspan="{count(columns/column)}">합계: <xsl:value-of select="sum(rows/r/c[3])"/> / <xsl:value-of select="key('colByName','Qty')/@label"/></td></tr></tfoot>
  </table>
</xsl:template>
<xsl:template match="column" mode="head"><th nowrap="nowrap" title="{@label}"><xsl:if test="@name = /gridRoot/setting[@name='sortColumnName']"><img src="images/sort-arrow-{substring('UpDown', 1 + 2 * ($dir = 'descending'), 4 - 2 * ($dir = 'descending'))}.gif"/></xsl:if><xsl:value-of select="@label"/></th></xsl:template>
<xsl:template name="indent"><xsl:param name="n"/><xsl:if test="$n &gt; 0"><img src="images/spacer.gif" width="16" height="16"/><xsl:call-template name="indent"><xsl:with-param name="n" select="$n - 1"/></xsl:call-template></xsl:if></xsl:template></xsl:stylesheet>