<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html"/>
<xsl:template match="/"><div title="{r/@a}" data-x="&lt;&amp;&gt;&quot;">é 한 &lt;&amp;&gt; "q"</div></xsl:template></xsl:stylesheet>