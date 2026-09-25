<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html"/>
<xsl:template match="/">
<html><head><title>Parts</title></head><body>
<table class="list" border="1" cellpadding="0">
<tr><th>ID</th><th>Name</th><th>Qty</th><th>Price</th></tr>
<xsl:for-each select="parts/part">
<tr class="{@state}" onclick="openPart('{@id}')">
<td><a href="detail.jsp?objectId={@id}&amp;mode=view name">&#160;<xsl:value-of select="@id"/></a></td>
<td><xsl:value-of select="name"/></td>
<td align="right"><xsl:value-of select="qty"/></td>
<td><xsl:value-of select="format-number(price, '#,##0.00')"/></td>
</tr>
</xsl:for-each>
</table>
<br/><hr/><img src="images/icon 1.gif" alt="a&lt;b"/><input type="checkbox" checked="checked" disabled="disabled"/>
<script type="text/javascript">if (a &lt; b &amp;&amp; c) { x = "<xsl:value-of select="count(//part)"/>"; }</script>
<style>td &gt; a { color: red }</style>
<textarea>a &lt; b</textarea>
<p>para <b>bold</b> text</p><pre>pre
 text</pre>
</body></html>
</xsl:template></xsl:stylesheet>