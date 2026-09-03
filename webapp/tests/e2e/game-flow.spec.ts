import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
});

test('complete game, recovery, new game, and abandon flow', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await expect(page.getByRole('heading', { name: '选择题目分类' })).toBeVisible();
  await page.getByRole('button', { name: /^动物/ }).click();
  await expect(page.getByRole('heading', { name: '动物 · 猜隐藏词' })).toBeVisible();
  await expect(page.getByLabel('你的猜测')).toBeFocused();

  await page.getByRole('button', { name: '← 首页' }).click();
  await expect(page.getByRole('heading', { name: '选择题目分类' })).toBeVisible();
  await expect(page.getByText('动物 · 已猜 0 次')).toBeVisible();
  await page.getByRole('button', { name: '继续本局' }).click();
  await expect(page.getByRole('heading', { name: '动物 · 猜隐藏词' })).toBeVisible();

  const guessCount = page.locator('.score-grid > div').filter({ hasText: '已猜' }).locator('strong');
  await page.getByLabel('你的猜测').fill('银行');
  await page.getByLabel('你的猜测').press('Enter');
  await expect(page.getByRole('listitem').filter({ hasText: '银行' })).toBeVisible();
  await expect(guessCount).toHaveText('1 次');

  await page.getByLabel('你的猜测').fill('南极');
  await page.getByRole('button', { name: '猜一下' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: '南极' })).toContainText('非常接近');
  await expect(guessCount).toHaveText('2 次');

  const guessRows = page.getByRole('list', { name: '有效猜测记录' }).getByRole('listitem');
  await expect(guessRows.nth(0)).toContainText('南极');

  await page.getByRole('button', { name: '按时间' }).click();
  await expect(page.getByRole('button', { name: '按时间' })).toHaveAttribute('aria-pressed', 'true');
  await expect(guessRows.nth(0)).toContainText('银行');
  await expect(guessRows.nth(1)).toContainText('南极');

  await page.getByLabel('你的猜测').fill('南极');
  await page.getByLabel('你的猜测').press('Enter');
  await expect(page.getByText('这个词已经猜过了。')).toBeVisible();
  await expect(guessCount).toHaveText('2 次');

  await page.getByRole('button', { name: /获取提示 1\/3/ }).click();
  await expect(page.getByText('生活在寒冷地区的鸟类')).toBeVisible();
  await page.reload();
  await expect(page.getByText('生活在寒冷地区的鸟类')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: '银行' })).toBeVisible();
  await expect(guessCount).toHaveText('2 次');

  await page.getByLabel('你的猜测').fill('企鹅');
  await page.getByLabel('你的猜测').press('Enter');
  await expect(page.getByRole('heading', { name: '猜中了！' })).toBeVisible();
  await expect(page.locator('.answer')).toContainText('企鹅');
  await expect(page.getByLabel('你的猜测')).toHaveCount(0);

  const storageSnapshot = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  expect(JSON.stringify(storageSnapshot)).not.toContain('企鹅');

  await expect(page.locator('.result-stats')).not.toContainText('最佳联想');
  await expect(page.locator('.result-stats')).not.toContainText('最接近的一次');
  await page.getByRole('button', { name: '分享战绩' }).click();
  await expect(page.locator('.share-message')).toContainText(/正在打开系统分享|正在复制战绩|战绩已|浏览器没有允许自动复制/);
  await page.getByRole('button', { name: '再玩一局' }).click();
  await expect(page.getByRole('heading', { name: '选择题目分类' })).toBeVisible();
  await page.getByRole('button', { name: /^动物/ }).click();
  await expect(page.getByRole('heading', { name: '动物 · 猜隐藏词' })).toBeVisible();
  await expect(guessCount).toHaveText('0 次');

  await page.getByRole('button', { name: '查看答案' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '继续猜' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '查看答案' }).click();
  await page.getByRole('button', { name: '结束并查看' }).click();
  await expect(page.getByRole('heading', { name: '答案揭晓' })).toBeVisible();
  await expect(page.locator('.answer')).toContainText('企鹅');
  await expect(page.locator('#game-message')).toHaveCount(0);
  await expect(page.locator('.score-grid')).toHaveCount(0);
  await expect(page.getByText('答案已揭晓，本局结果已生成。')).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(consoleErrors).toEqual([]);
});

test('validation, keyboard focus, and accessibility states', async ({ page }) => {
  await expect(page.getByRole('heading', { name: '选择题目分类' })).toBeVisible();
  await page.getByRole('button', { name: /^动物/ }).click();
  await expect(page.getByRole('heading', { name: '动物 · 猜隐藏词' })).toBeVisible();
  await expect(page.getByText('测试评分', { exact: true })).toBeVisible();
  const input = page.getByLabel('你的猜测');
  const unknownScores: number[] = [];
  for (const word of ['桌子', '手机']) {
    await input.fill(word);
    await input.press('Enter');
    const row = page.getByRole('listitem').filter({ hasText: word });
    await expect(row).toBeVisible();
    const score = (await row.innerText()).match(/(\d+\.\d{3})%/)?.[1];
    expect(score).toBeDefined();
    unknownScores.push(Number(score));
  }
  expect(unknownScores[0]).not.toBe(unknownScores[1]);

  await input.fill('penguin');
  await input.press('Enter');
  await expect(page.getByText('目前只支持 1～10 个连续汉字。')).toBeVisible();
  await expect(input).toBeFocused();

  const activeResults = await new AxeBuilder({ page }).analyze();
  expect(activeResults.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);

  await page.getByRole('button', { name: '查看答案' }).click();
  const continueButton = page.getByRole('button', { name: '继续猜' });
  const confirmButton = page.getByRole('button', { name: '结束并查看' });
  await expect(continueButton).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirmButton).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(continueButton).toBeFocused();
  const dialogResults = await new AxeBuilder({ page }).include('.confirm-dialog').analyze();
  expect(dialogResults.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查看答案' })).toBeFocused();
});

test('daily challenge becomes a saved result and cannot be started twice', async ({ page }) => {
  await page.getByRole('button', { name: /每日挑战/ }).click();
  await expect(page.getByRole('heading', { name: /猜隐藏词/ })).toBeVisible();

  await page.getByRole('button', { name: '查看答案' }).click();
  await page.getByRole('button', { name: '结束并查看' }).click();
  await expect(page.getByRole('heading', { name: '答案揭晓' })).toBeVisible();

  await page.getByRole('button', { name: '再玩一局' }).click();
  const dailyResult = page.getByLabel('今日挑战结果');
  await expect(dailyResult).toBeVisible();
  await expect(dailyResult).toContainText('今日挑战已完成');
  await expect(dailyResult).toContainText('已揭晓');
  await expect(page.getByRole('button', { name: '每日挑战', exact: true })).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: '返回 GuessWord 首页' }).click();
  await expect(page.getByLabel('今日挑战结果')).toBeVisible();
  await expect(page.getByRole('button', { name: '每日挑战', exact: true })).toHaveCount(0);
});

test('expanded categories expose word length and a prominent hint action', async ({ page }) => {
  await expect(page.getByRole('button', { name: /^历史人物/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^体育圈/ })).toBeVisible();
  await page.getByRole('button', { name: /^历史人物/ }).click();

  await expect(page.getByRole('heading', { name: '历史人物 · 猜隐藏词' })).toBeVisible();
  await expect(page.getByText(/^目标 [2-4] 个字$/)).toBeVisible();
  const hintButton = page.getByRole('button', { name: /获取提示 1\/3/ });
  await expect(hintButton).toBeVisible();
  await expect(hintButton).toHaveClass(/hint-action/);
  await hintButton.click();
  await expect(page.getByRole('list', { name: '已揭示提示' })).toContainText('更具体的范围');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
