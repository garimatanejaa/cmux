import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Platform, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { parseAnsi, withCursor, type ScreenState, type Span } from "@brb/protocol";
import { colors } from "../theme";
import { Button } from "./ui";

const FONT_SIZE = 11;
const CHAR_WIDTH = FONT_SIZE * 0.6;
const LINE_HEIGHT = Math.round(FONT_SIZE * 1.35);
const FONT = Platform.select({ ios: "Menlo", default: "monospace" });

const Row = memo(function Row({ spans }: { spans: Span[] }) {
  return (
    <Text numberOfLines={1} allowFontScaling={false} style={styles.row}>
      {spans.length === 0 ? " " : spans.map((span, i) => {
        const fg = span.inverse ? (span.bg ?? colors.termBg) : span.fg;
        const bg = span.inverse ? (span.fg ?? colors.termFg) : span.bg;
        return (
          <Text
            key={i}
            style={{
              color: fg,
              backgroundColor: bg,
              fontWeight: span.bold ? "700" : undefined,
              fontStyle: span.italic ? "italic" : undefined,
              opacity: span.dim ? 0.6 : undefined,
              textDecorationLine: span.underline && span.strike ? "underline line-through"
                : span.underline ? "underline" : span.strike ? "line-through" : "none",
            }}
          >
            {span.text}
          </Text>
        );
      })}
    </Text>
  );
});

/** Draws a terminal screen: styled rows, scroll both ways, follows new output until you scroll up. */
export function TerminalView({ screen }: { screen: ScreenState | undefined }) {
  const list = useRef<FlatList<string>>(null);
  const [follow, setFollow] = useState(true);
  const rows = screen?.rows ?? [];

  useEffect(() => {
    if (follow && rows.length > 0) requestAnimationFrame(() => list.current?.scrollToEnd({ animated: false }));
  }, [screen?.rev, follow, rows.length]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - LINE_HEIGHT * 2;
    setFollow(atBottom);
  }, []);

  if (!screen) {
    return (
      <View style={[styles.terminal, styles.empty]}>
        <Text style={{ color: colors.muted }}>Waiting for the terminal…</Text>
      </View>
    );
  }

  const cursorRow = screen.cursor.y;
  const width = Math.max(screen.cols, 20) * CHAR_WIDTH + 16;

  return (
    <View style={styles.terminal}>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <FlatList
          ref={list}
          data={rows}
          keyExtractor={(_, i) => String(i)}
          style={{ width }}
          initialNumToRender={60}
          windowSize={9}
          onScroll={onScroll}
          scrollEventThrottle={64}
          getItemLayout={(_, index) => ({ length: LINE_HEIGHT, offset: LINE_HEIGHT * index, index })}
          renderItem={({ item, index }) => {
            const spans = parseAnsi(item);
            return <Row spans={index === cursorRow ? withCursor(spans, screen.cursor.x) : spans} />;
          }}
          extraData={screen.rev}
        />
      </ScrollView>
      {!follow && (
        <View style={styles.jump}>
          <Button label="Jump to bottom" kind="secondary" onPress={() => setFollow(true)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  terminal: { flex: 1, backgroundColor: colors.termBg },
  empty: { alignItems: "center", justifyContent: "center" },
  row: {
    fontFamily: FONT, fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT, height: LINE_HEIGHT,
    color: colors.termFg, paddingHorizontal: 8,
  },
  jump: { position: "absolute", right: 12, bottom: 12 },
});
