# Reference transformer (oracle)

`blinkxslt.c` produces the expected results in `test/cases/*/expected.json`. It drives libxslt and libxml2
the same way Chrome's `XSLTProcessor` does (see the comment at the top of the file). You only need it to
add or change test cases; `npm test` uses the committed `expected.json` files.

## Build

The expected results were generated with libxml2 2.16.0, libxslt 1.1.45 and ICU 74 on Linux.

```sh
# libxml2 and libxslt from source, installed into $PREFIX
PREFIX=$HOME/lxinst
(cd libxml2-2.16.0 && ./configure --prefix=$PREFIX --without-python && make -j && make install)
(cd libxslt-1.1.45 && ./configure --prefix=$PREFIX --with-libxml-prefix=$PREFIX --without-python && make -j && make install)

# the oracle; ICU headers are not needed, only the shared libraries
gcc -O1 -o tools/oracle/blinkxslt tools/oracle/blinkxslt.c \
    -I$PREFIX/include/libxml2 -I$PREFIX/include -L$PREFIX/lib -lxslt -lxml2 -lm \
    /usr/lib/x86_64-linux-gnu/libicui18n.so.74 /usr/lib/x86_64-linux-gnu/libicuuc.so.74 \
    -Wl,-rpath,$PREFIX/lib
```

The ICU functions are declared in the source with the `_74` version suffix. With another ICU version,
change the suffix (for example `ucol_open_76`) and the library paths.

## Regenerate expected results

```sh
node tools/oracle/regen-expected.js tools/oracle/blinkxslt          # all cases
node tools/oracle/regen-expected.js tools/oracle/blinkxslt my_case  # one case
npm test
```

A test case is a folder in `test/cases/` with `in.xml`, `t.xsl`, optionally `params.txt`
(one `name<TAB>value` per line) and any files the stylesheet loads with `xsl:include`, `xsl:import` or `document()`.
