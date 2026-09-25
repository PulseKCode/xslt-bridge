<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="xml" doctype-system="parts.dtd" cdata-section-elements="code" indent="yes"/>
<xsl:template match="/"><!--c1--><doc><code>a &lt; b ]]&gt; c</code><code/><other>x</other></doc></xsl:template></xsl:stylesheet>