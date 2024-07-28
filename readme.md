<h1 style="text-align: center;">NJS-AliDDNS</h1>

# 需求
阿里云提供了开放的接口修改解析，只要使用了阿里DNS，无论付费免费都可以使用脚本修改
而对于动态IP地址，这个接口太有用了，只需要一个程序...等等，好AliDDNS程序应该是

 - 可以集成在某个软件的
 - 小巧，便于在嵌入式中使用
 - 轻量无依赖，不要运行的使用`openssl: Command not found`

综上，我结合了`Nginx-NJS`开发了njs-aliddns，方便、简洁、无惧空间小

# 安装手册
请参考
https://hi.imzlh.top/2024/07/28.cgi