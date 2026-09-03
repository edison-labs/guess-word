import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GuessWord｜语义猜词游戏',
  description: '根据词义、用途、场景与相似点的关系反馈，找到隐藏的中文词语。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
