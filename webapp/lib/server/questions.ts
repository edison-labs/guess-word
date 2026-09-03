import { GAME_CATEGORIES, type GameCategory } from '../contracts';

export type Question = {
  id: string;
  answer: string;
  category: GameCategory;
  subcategory: string;
  length: number;
  hotHint: string;
  active: boolean;
  testVector: readonly number[];
};

function vector(categoryIndex: number, traitA: number, traitB: number): readonly number[] {
  const result = [-0.18, -0.18, -0.18, -0.18, -0.18, -0.18, -0.18, -0.18, traitA, traitB];
  result[categoryIndex] = 1;
  return result;
}

function question(
  id: string,
  answer: string,
  category: GameCategory,
  subcategory: string,
  hotHint: string,
  categoryIndex: number,
  traitA: number,
  traitB: number,
): Question {
  return {
    id,
    answer,
    category,
    subcategory,
    length: Array.from(answer).length,
    hotHint,
    active: true,
    testVector: vector(categoryIndex, traitA, traitB),
  };
}

export const QUESTIONS: readonly Question[] = [
  question('animal_penguin', '企鹅', '动物', '生活在寒冷地区的鸟类', '南极', 0, -0.9, 0.9),
  question('animal_panda', '熊猫', '动物', '以竹子为食的哺乳动物', '竹林', 0, 0.7, 0.6),
  question('animal_dolphin', '海豚', '动物', '聪明的海洋哺乳动物', '声呐', 0, -0.7, 0.4),
  question('animal_giraffe', '长颈鹿', '动物', '生活在草原的高大哺乳动物', '树梢', 0, 0.9, -0.1),
  question('animal_butterfly', '蝴蝶', '动物', '会经历变态发育的昆虫', '花丛', 0, 0.2, -0.9),
  question('animal_elephant', '大象', '动物', '体型庞大的陆生哺乳动物', '象鼻', 0, 0.9, 0.2),
  question('animal_tiger', '老虎', '动物', '有条纹的大型猫科动物', '森林', 0, 0.8, -0.4),
  question('animal_rabbit', '兔子', '动物', '长耳朵的小型哺乳动物', '胡萝卜', 0, 0.3, 0.8),
  question('animal_kangaroo', '袋鼠', '动物', '善于跳跃且育有育儿袋', '澳洲', 0, 0.7, -0.3),
  question('animal_zebra', '斑马', '动物', '身上有黑白条纹的草原动物', '条纹', 0, 0.6, -0.5),
  question('animal_camel', '骆驼', '动物', '适应干旱环境的有蹄动物', '沙漠', 0, 0.5, 0.3),
  question('animal_squirrel', '松鼠', '动物', '会储藏坚果的小型啮齿动物', '橡果', 0, 0.1, 0.7),
  question('animal_peacock', '孔雀', '动物', '雄性尾羽艳丽的鸟类', '开屏', 0, 0.2, -0.6),
  question('animal_octopus', '章鱼', '动物', '拥有八条腕足的海洋软体动物', '触手', 0, -0.8, -0.2),
  question('animal_hippo', '河马', '动物', '常在水中活动的大型哺乳动物', '泥潭', 0, 0.8, 0.4),
  question('animal_rhino', '犀牛', '动物', '鼻部生有角的大型哺乳动物', '厚皮', 0, 0.9, -0.6),
  question('animal_owl', '猫头鹰', '动物', '多在夜间活动的猛禽', '夜行', 0, -0.4, -0.8),

  question('food_apple', '苹果', '食物', '常见的温带水果', '果园', 1, 0.7, 0.5),
  question('food_hotpot', '火锅', '食物', '多人围坐享用的热食', '汤底', 1, -0.2, 0.9),
  question('food_dumpling', '饺子', '食物', '带馅的传统面食', '年夜饭', 1, 0.4, 0.7),
  question('food_bread', '面包', '食物', '经过烘焙的主食', '烤箱', 1, 0.1, 0.5),
  question('food_tofu', '豆腐', '食物', '由豆类加工成的食材', '豆浆', 1, 0.6, -0.1),
  question('food_chocolate', '巧克力', '食物', '常见的甜味零食', '可可', 1, -0.5, 0.4),
  question('food_rice', '米饭', '食物', '由稻米蒸煮成的主食', '饭碗', 1, 0.7, 0.2),
  question('food_noodles', '面条', '食物', '细长条状的常见主食', '筷子', 1, 0.4, 0.6),
  question('food_cake', '蛋糕', '食物', '庆祝时常见的烘焙甜点', '生日', 1, 0.1, 0.8),
  question('food_sushi', '寿司', '食物', '以醋饭搭配配料的料理', '日料', 1, -0.3, 0.5),
  question('food_zongzi', '粽子', '食物', '用叶片包裹糯米蒸制的传统食品', '端午', 1, 0.5, 0.7),
  question('food_mooncake', '月饼', '食物', '圆形带馅的传统糕点', '中秋', 1, 0.3, 0.9),
  question('food_icecream', '冰淇淋', '食物', '低温食用的乳制甜品', '甜筒', 1, -0.8, 0.6),
  question('food_hamburger', '汉堡', '食物', '面包夹肉饼和配菜的快餐', '快餐', 1, -0.1, 0.5),
  question('food_yogurt', '酸奶', '食物', '牛奶发酵制成的饮品', '发酵', 1, -0.4, 0.2),
  question('food_corn', '玉米', '食物', '颗粒排列在果穗上的谷物', '田野', 1, 0.8, -0.2),
  question('food_coffee', '咖啡', '食物', '由烘焙豆冲泡的饮品', '提神', 1, -0.6, -0.5),

  question('job_doctor', '医生', '职业', '在医疗机构诊疗疾病', '听诊器', 2, 0.8, 0.2),
  question('job_teacher', '教师', '职业', '在学校传授知识', '课堂', 2, 0.6, 0.6),
  question('job_firefighter', '消防员', '职业', '负责灭火和紧急救援', '消防车', 2, 0.9, -0.5),
  question('job_lawyer', '律师', '职业', '提供法律服务', '法庭', 2, -0.2, 0.7),
  question('job_chef', '厨师', '职业', '在厨房制作菜肴', '菜刀', 2, 0.2, 0.9),
  question('job_architect', '建筑师', '职业', '设计建筑空间', '蓝图', 2, -0.6, 0.5),
  question('job_police', '警察', '职业', '维护公共秩序与安全', '警徽', 2, 0.7, -0.5),
  question('job_reporter', '记者', '职业', '采访并报道新闻事件', '新闻', 2, -0.4, 0.4),
  question('job_driver', '司机', '职业', '驾驶交通工具运送人员或货物', '方向盘', 2, 0.2, -0.6),
  question('job_nurse', '护士', '职业', '在医疗机构提供护理服务', '病房', 2, 0.6, 0.3),
  question('job_guide', '导游', '职业', '带领游客参观并进行讲解', '景点', 2, -0.1, 0.8),
  question('job_painter', '画家', '职业', '用绘画进行艺术创作', '画布', 2, -0.7, 0.6),
  question('job_pilot', '飞行员', '职业', '驾驶航空器执行飞行任务', '驾驶舱', 2, 0.8, -0.7),
  question('job_programmer', '程序员', '职业', '编写和维护计算机程序', '代码', 2, -0.5, -0.2),
  question('job_farmer', '农民', '职业', '从事农业生产劳动', '农田', 2, 0.5, 0.7),
  question('job_barber', '理发师', '职业', '为顾客修剪和打理头发', '发型', 2, 0.1, 0.9),
  question('job_courier', '快递员', '职业', '将包裹送到收件人手中', '包裹', 2, 0.4, -0.3),

  question('nature_rainbow', '彩虹', '自然现象', '阳光与水滴共同形成的光学现象', '七色', 3, 0.5, 0.7),
  question('nature_typhoon', '台风', '自然现象', '发生在热带海洋的强烈风暴', '风眼', 3, -0.4, 0.9),
  question('nature_avalanche', '雪崩', '自然现象', '大量积雪沿山坡快速下滑', '雪山', 3, -0.8, 0.5),
  question('nature_volcano', '火山', '自然现象', '地球内部物质喷出的地貌', '岩浆', 3, 0.8, -0.4),
  question('nature_lightning', '闪电', '自然现象', '云层间发生的强烈放电', '雷声', 3, 0.3, -0.8),
  question('nature_aurora', '极光', '自然现象', '高纬夜空中的发光现象', '北极', 3, -0.7, -0.2),
  question('nature_earthquake', '地震', '自然现象', '地壳运动引发的地面震动', '震级', 3, 0.8, -0.6),
  question('nature_tsunami', '海啸', '自然现象', '海底扰动引发的巨大海浪', '巨浪', 3, -0.8, 0.8),
  question('nature_waterfall', '瀑布', '自然现象', '河水从陡峭高处倾泻而下', '悬崖', 3, 0.5, 0.3),
  question('nature_dew', '露珠', '自然现象', '水汽在物体表面凝结成的小水滴', '清晨', 3, -0.3, 0.6),
  question('nature_frost', '霜冻', '自然现象', '低温使近地面水汽凝华结冰', '寒夜', 3, -0.7, 0.4),
  question('nature_meteor', '流星', '自然现象', '天体进入大气层产生的发光轨迹', '夜空', 3, -0.4, -0.7),
  question('nature_tornado', '龙卷风', '自然现象', '高速旋转的漏斗状强风', '气旋', 3, 0.7, -0.8),
  question('nature_hail', '冰雹', '自然现象', '强对流云中降落的冰粒', '雷雨', 3, -0.5, 0.7),
  question('nature_fog', '雾气', '自然现象', '近地面悬浮水滴降低能见度', '朦胧', 3, -0.6, 0.2),
  question('nature_tide', '潮汐', '自然现象', '海水受天体引力发生周期涨落', '月球', 3, -0.2, 0.5),
  question('nature_mirage', '海市蜃楼', '自然现象', '光线折射形成的虚幻景象', '幻景', 3, 0.2, -0.5),

  question('abstract_courage', '勇气', '抽象概念', '面对困难仍然行动的品质', '无畏', 4, 0.9, -0.1),
  question('abstract_friendship', '友谊', '抽象概念', '朋友之间长期的情感联系', '伙伴', 4, 0.6, 0.7),
  question('abstract_patience', '耐心', '抽象概念', '面对等待或困难时保持平稳的品质', '坚持', 4, -0.5, 0.8),
  question('abstract_memory', '记忆', '抽象概念', '保存和回想经历的能力', '回忆', 4, -0.2, 0.6),
  question('abstract_freedom', '自由', '抽象概念', '不受不合理限制的状态', '自主', 4, 0.8, 0.2),
  question('abstract_hope', '希望', '抽象概念', '对未来美好结果的期待', '曙光', 4, 0.4, -0.7),
  question('abstract_honesty', '诚实', '抽象概念', '言行真实且不欺骗的品质', '坦白', 4, 0.7, 0.3),
  question('abstract_happiness', '幸福', '抽象概念', '生活如意而产生的满足感', '满足', 4, 0.5, 0.8),
  question('abstract_responsibility', '责任', '抽象概念', '对职责和后果主动承担', '担当', 4, 0.8, -0.3),
  question('abstract_trust', '信任', '抽象概念', '相信对方可靠和诚恳的态度', '托付', 4, 0.3, 0.7),
  question('abstract_curiosity', '好奇', '抽象概念', '对未知事物想要了解的心理', '探索', 4, -0.1, 0.9),
  question('abstract_fairness', '公平', '抽象概念', '按一致合理标准对待各方', '平等', 4, 0.6, -0.2),
  question('abstract_wisdom', '智慧', '抽象概念', '理解和处理问题的综合能力', '洞察', 4, -0.4, 0.5),
  question('abstract_loneliness', '孤独', '抽象概念', '缺少陪伴或联系的主观感受', '独处', 4, -0.7, -0.4),
  question('abstract_justice', '正义', '抽象概念', '维护公正与合理秩序的价值', '公理', 4, 0.9, -0.5),
  question('abstract_dream', '梦想', '抽象概念', '对未来目标的强烈向往', '追求', 4, 0.4, 0.6),
  question('abstract_creativity', '创造力', '抽象概念', '产生新想法和新事物的能力', '灵感', 4, -0.2, -0.8),

  question('object_umbrella', '雨伞', '日常物品', '雨天用于遮挡雨水', '伞柄', 5, 0.4, 0.8),
  question('object_fridge', '冰箱', '日常物品', '低温保存食物的家用电器', '冷藏', 5, -0.7, 0.5),
  question('object_lamp', '台灯', '日常物品', '放在桌面提供照明', '灯罩', 5, 0.6, -0.4),
  question('object_backpack', '书包', '日常物品', '学生常用的携带用品', '肩带', 5, 0.7, 0.4),
  question('object_key', '钥匙', '日常物品', '用于开启锁具的小型工具', '锁孔', 5, -0.2, 0.9),
  question('object_mirror', '镜子', '日常物品', '利用反射呈现影像', '倒影', 5, -0.5, -0.6),
  question('object_phone', '手机', '日常物品', '便携式通信和计算设备', '触屏', 5, -0.2, -0.7),
  question('object_scissors', '剪刀', '日常物品', '用两片刀刃剪切材料的工具', '裁剪', 5, 0.3, 0.8),
  question('object_toothbrush', '牙刷', '日常物品', '清洁牙齿时使用的个人用品', '刷毛', 5, 0.5, 0.6),
  question('object_watch', '手表', '日常物品', '佩戴在手腕上查看时间', '表带', 5, -0.3, 0.7),
  question('object_pillow', '枕头', '日常物品', '睡眠时承托头部的寝具', '睡眠', 5, 0.7, 0.3),
  question('object_cup', '水杯', '日常物品', '盛装饮用水的容器', '杯盖', 5, 0.4, 0.5),
  question('object_travel_backpack', '背包', '日常物品', '用肩带背负物品的袋子', '出行', 5, 0.6, -0.2),
  question('object_camera', '相机', '日常物品', '拍摄并记录影像的设备', '镜头', 5, -0.4, -0.5),
  question('object_microwave', '微波炉', '日常物品', '快速加热食物的厨房电器', '加热', 5, -0.6, 0.4),
  question('object_headphones', '耳机', '日常物品', '贴近耳朵播放声音的设备', '听歌', 5, -0.5, -0.7),
  question('object_alarm', '闹钟', '日常物品', '在设定时间发声提醒的用品', '起床', 5, 0.1, -0.6),

  question('animal_koala', '考拉', '动物', '栖息在树上并以桉树叶为食的动物', '桉树', 0, 0.4, 0.8),
  question('animal_polarbear', '北极熊', '动物', '生活在北极地区的大型熊科动物', '浮冰', 0, -0.8, 0.6),
  question('animal_hedgehog', '刺猬', '动物', '背部长满硬刺的小型哺乳动物', '尖刺', 0, 0.2, 0.5),
  question('animal_flamingo', '火烈鸟', '动物', '羽毛粉红且腿部修长的水鸟', '盐湖', 0, -0.3, -0.6),
  question('animal_seahorse', '海马', '动物', '头部似马的海洋鱼类', '珊瑚', 0, -0.7, 0.1),
  question('animal_pangolin', '穿山甲', '动物', '全身覆盖鳞片的哺乳动物', '鳞片', 0, 0.5, -0.4),
  question('animal_alpaca', '羊驼', '动物', '产毛且性情温顺的南美动物', '高原', 0, 0.6, 0.3),
  question('animal_firefly', '萤火虫', '动物', '腹部能够发光的小型昆虫', '夏夜', 0, -0.2, -0.9),
  question('food_pineapple', '菠萝', '食物', '外皮带刺的热带水果', '热带', 1, 0.6, 0.2),
  question('food_porridge', '米粥', '食物', '稻米加水慢煮成的流质主食', '早餐', 1, 0.5, 0.6),
  question('food_pizza', '披萨', '食物', '带有奶酪和配料的烘烤面饼', '奶酪', 1, -0.1, 0.7),
  question('food_soymilk', '豆浆', '食物', '黄豆研磨煮制的饮品', '黄豆', 1, 0.7, -0.1),
  question('food_honey', '蜂蜜', '食物', '蜜蜂酿造的天然甜味食品', '蜂巢', 1, 0.3, 0.8),
  question('food_popcorn', '爆米花', '食物', '玉米受热膨化而成的零食', '电影', 1, -0.2, 0.5),
  question('food_lemonade', '柠檬水', '食物', '带酸味的清爽饮品', '酸味', 1, -0.5, 0.4),
  question('food_roastduck', '烤鸭', '食物', '外皮酥脆的烤制禽类菜肴', '酥皮', 1, 0.2, 0.9),
  question('job_vet', '兽医', '职业', '为动物诊断和治疗疾病', '宠物', 2, 0.6, 0.1),
  question('job_judge', '法官', '职业', '在法庭依法审理案件', '法槌', 2, -0.1, 0.7),
  question('job_astronaut', '宇航员', '职业', '在太空执行任务的专业人员', '飞船', 2, -0.7, -0.5),
  question('job_photographer', '摄影师', '职业', '使用相机进行影像创作', '快门', 2, -0.4, 0.5),
  question('job_dentist', '牙医', '职业', '诊治口腔和牙齿疾病', '牙椅', 2, 0.7, 0.3),
  question('job_translator', '翻译员', '职业', '在不同语言之间转换内容', '语言', 2, -0.3, 0.8),
  question('job_plumber', '水管工', '职业', '安装和维修供排水管道', '扳手', 2, 0.4, -0.2),
  question('job_scientist', '科学家', '职业', '通过研究探索自然规律', '实验室', 2, -0.6, 0.4),
  question('nature_eclipse', '日食', '自然现象', '月球遮挡太阳形成的天文现象', '月影', 3, -0.5, -0.5),
  question('nature_snowflake', '雪花', '自然现象', '水汽凝华形成的冰晶', '六角', 3, -0.7, 0.4),
  question('nature_drought', '干旱', '自然现象', '长期少雨导致缺水的现象', '龟裂', 3, 0.6, -0.2),
  question('nature_monsoon', '季风', '自然现象', '随季节改变方向的大范围风系', '雨季', 3, 0.2, 0.7),
  question('nature_stalactite', '钟乳石', '自然现象', '洞穴中逐渐沉积形成的石体', '溶洞', 3, 0.7, 0.2),
  question('nature_quicksand', '流沙', '自然现象', '饱含水分而失去承载力的沙层', '陷落', 3, 0.5, -0.4),
  question('nature_sunrise', '日出', '自然现象', '太阳从地平线升起的景象', '晨曦', 3, -0.2, 0.6),
  question('nature_whirlpool', '漩涡', '自然现象', '水体旋转形成的漏斗状流动', '旋转', 3, -0.4, 0.3),
  question('abstract_empathy', '共情', '抽象概念', '理解并感受他人情绪的能力', '理解', 4, 0.3, 0.8),
  question('abstract_discipline', '自律', '抽象概念', '主动约束自己并坚持规则', '克制', 4, 0.6, 0.2),
  question('abstract_regret', '遗憾', '抽象概念', '因未能如愿而产生的惋惜', '错过', 4, -0.4, 0.5),
  question('abstract_dignity', '尊严', '抽象概念', '值得尊重且不容贬损的价值', '尊重', 4, 0.7, -0.1),
  question('abstract_inspiration', '灵感', '抽象概念', '突然出现的创造性思路', '顿悟', 4, -0.3, -0.7),
  question('abstract_tolerance', '宽容', '抽象概念', '理解并接纳不同或过失的态度', '包容', 4, 0.4, 0.7),
  question('abstract_ambition', '抱负', '抽象概念', '希望成就事业的远大志向', '志向', 4, 0.8, -0.4),
  question('abstract_serenity', '宁静', '抽象概念', '安定平和而少受扰动的状态', '安详', 4, -0.6, 0.3),
  question('object_thermos', '保温杯', '日常物品', '用于保持饮品温度的容器', '杯盖', 5, 0.4, 0.6),
  question('object_stapler', '订书机', '日常物品', '用金属钉装订纸张的工具', '文件', 5, 0.2, 0.8),
  question('object_flashlight', '手电筒', '日常物品', '便携式手持照明工具', '电池', 5, 0.5, -0.5),
  question('object_keyboard', '键盘', '日常物品', '向计算机输入文字和指令的设备', '按键', 5, -0.3, -0.7),
  question('object_suitcase', '行李箱', '日常物品', '旅行时装载随身物品的箱子', '拉杆', 5, 0.6, -0.2),
  question('object_hairdryer', '吹风机', '日常物品', '吹出热风使头发干燥的电器', '热风', 5, -0.5, 0.5),
  question('object_chopsticks', '筷子', '日常物品', '夹取食物的一双细长餐具', '餐桌', 5, 0.3, 0.7),
  question('object_powerbank', '充电宝', '日常物品', '为移动设备补充电量的便携电源', '电量', 5, -0.4, -0.6),

  question('history_confucius', '孔子', '历史人物', '春秋时期的思想家和教育家', '儒家', 6, -0.5, 0.8),
  question('history_mencius', '孟子', '历史人物', '战国时期的儒家思想家', '性善论', 6, -0.4, 0.7),
  question('history_qin_shihuang', '秦始皇', '历史人物', '完成中国首次大一统的秦朝皇帝', '长城', 6, 0.9, -0.5),
  question('history_han_wudi', '汉武帝', '历史人物', '开拓汉朝疆域的皇帝', '丝绸之路', 6, 0.8, -0.4),
  question('history_sima_qian', '司马迁', '历史人物', '西汉时期的史学家', '史记', 6, -0.6, 0.6),
  question('history_cao_cao', '曹操', '历史人物', '东汉末年的政治家和军事家', '魏国', 6, 0.7, -0.3),
  question('history_liu_bei', '刘备', '历史人物', '三国时期蜀汉的建立者', '桃园', 6, 0.6, 0.2),
  question('history_zhuge_liang', '诸葛亮', '历史人物', '三国时期蜀汉丞相', '隆中对', 6, -0.2, 0.9),
  question('history_li_shimin', '李世民', '历史人物', '开创贞观之治的唐朝皇帝', '贞观', 6, 0.8, 0.1),
  question('history_wu_zetian', '武则天', '历史人物', '中国历史上的女皇帝', '周朝', 6, 0.7, -0.6),
  question('history_li_bai', '李白', '历史人物', '唐代浪漫主义诗人', '诗仙', 6, -0.7, 0.5),
  question('history_du_fu', '杜甫', '历史人物', '唐代现实主义诗人', '诗圣', 6, -0.6, 0.4),
  question('history_su_shi', '苏轼', '历史人物', '北宋文学家和书画家', '东坡', 6, -0.5, 0.6),
  question('history_yue_fei', '岳飞', '历史人物', '南宋抗金名将', '精忠报国', 6, 0.8, -0.2),
  question('history_genghis_khan', '成吉思汗', '历史人物', '蒙古帝国的奠基者', '草原', 6, 0.9, -0.7),
  question('history_zhu_yuanzhang', '朱元璋', '历史人物', '明朝开国皇帝', '洪武', 6, 0.8, -0.3),
  question('history_zheng_he', '郑和', '历史人物', '明代率船队远航的航海家', '下西洋', 6, 0.2, 0.8),
  question('history_wang_yangming', '王阳明', '历史人物', '明代思想家和心学代表', '知行合一', 6, -0.5, 0.9),
  question('history_kangxi', '康熙', '历史人物', '清朝在位时间很长的皇帝', '盛世', 6, 0.6, -0.1),
  question('history_qianlong', '乾隆', '历史人物', '清朝中期的皇帝', '下江南', 6, 0.5, -0.2),
  question('history_lin_zexu', '林则徐', '历史人物', '晚清主张禁烟的政治家', '虎门销烟', 6, 0.4, 0.7),
  question('history_sun_yat_sen', '孙中山', '历史人物', '中国近代民主革命先行者', '辛亥革命', 6, 0.6, 0.5),
  question('history_lu_xun', '鲁迅', '历史人物', '中国现代文学的重要作家', '呐喊', 6, -0.7, 0.3),
  question('history_zhang_qian', '张骞', '历史人物', '西汉出使西域的使者', '西域', 6, 0.2, 0.7),
  question('history_wang_zhaojun', '王昭君', '历史人物', '汉代出塞和亲的历史人物', '出塞', 6, -0.1, 0.6),

  question('sports_yao_ming', '姚明', '体育圈', '中国男子篮球运动员', 'NBA', 7, 0.8, 0.4),
  question('sports_liu_xiang', '刘翔', '体育圈', '中国男子跨栏运动员', '栏王', 7, 0.7, -0.3),
  question('sports_li_na', '李娜', '体育圈', '中国女子网球运动员', '大满贯', 7, 0.4, 0.7),
  question('sports_su_bingtian', '苏炳添', '体育圈', '中国男子短跑运动员', '百米', 7, 0.8, -0.5),
  question('sports_gu_ailing', '谷爱凌', '体育圈', '自由式滑雪运动员', '冬奥会', 7, -0.6, 0.7),
  question('sports_quan_hongchan', '全红婵', '体育圈', '中国女子跳水运动员', '十米台', 7, -0.3, 0.9),
  question('sports_ma_long', '马龙', '体育圈', '中国男子乒乓球运动员', '全满贯', 7, 0.5, 0.8),
  question('sports_zhang_jike', '张继科', '体育圈', '中国男子乒乓球运动员', '横板', 7, 0.4, 0.7),
  question('sports_sun_yingsha', '孙颖莎', '体育圈', '中国女子乒乓球运动员', '国乒', 7, 0.3, 0.8),
  question('sports_lang_ping', '郎平', '体育圈', '中国排球运动员和教练', '铁榔头', 7, 0.7, 0.5),
  question('sports_zhu_ting', '朱婷', '体育圈', '中国女子排球运动员', '主攻', 7, 0.6, 0.6),
  question('sports_guo_jingjing', '郭晶晶', '体育圈', '中国女子跳水运动员', '跳水皇后', 7, -0.2, 0.8),
  question('sports_lin_dan', '林丹', '体育圈', '中国男子羽毛球运动员', '超级丹', 7, 0.5, 0.4),
  question('sports_li_ning', '李宁', '体育圈', '中国男子体操运动员', '体操王子', 7, 0.6, -0.1),
  question('sports_xu_haifeng', '许海峰', '体育圈', '中国男子射击运动员', '首金', 7, -0.2, 0.6),
  question('sports_deng_yaping', '邓亚萍', '体育圈', '中国女子乒乓球运动员', '小个子', 7, 0.3, 0.7),
  question('sports_wang_meng', '王濛', '体育圈', '中国女子短道速滑运动员', '冰刀', 7, -0.7, 0.5),
  question('sports_wu_dajing', '武大靖', '体育圈', '中国男子短道速滑运动员', '短道', 7, -0.8, 0.4),
  question('sports_zheng_qinwen', '郑钦文', '体育圈', '中国女子网球运动员', '网球', 7, 0.2, 0.7),
  question('sports_pan_zhanle', '潘展乐', '体育圈', '中国男子游泳运动员', '自由泳', 7, -0.5, 0.6),
  question('sports_messi', '梅西', '体育圈', '阿根廷男子足球运动员', '世界杯', 7, 0.8, -0.4),
  question('sports_pele', '贝利', '体育圈', '巴西男子足球运动员', '球王', 7, 0.9, -0.5),
  question('sports_bryant', '科比', '体育圈', '美国男子篮球运动员', '湖人', 7, 0.8, 0.2),
  question('sports_jordan', '乔丹', '体育圈', '美国男子篮球运动员', '飞人', 7, 0.9, 0.1),
  question('sports_bolt', '博尔特', '体育圈', '牙买加男子短跑运动员', '闪电', 7, 0.8, -0.6),
] as const;

export function validateQuestionBank(questions: readonly Question[]): string[] {
  const errors: string[] = [];
  const minimumQuestions = GAME_CATEGORIES.length * 25;
  if (questions.length < minimumQuestions) errors.push(`题库至少需要 ${minimumQuestions} 道题。`);
  const categories = new Set<string>();
  const ids = new Set<string>();
  const answers = new Set<string>();

  for (const item of questions) {
    categories.add(item.category);
    if (!item.id || !item.answer || !item.category || !item.subcategory || !item.hotHint) {
      errors.push(`${item.id || 'unknown'} 存在缺失字段。`);
    }
    if (ids.has(item.id)) errors.push(`题目 ID 重复：${item.id}`);
    ids.add(item.id);
    const normalizedAnswer = item.answer.normalize('NFKC').trim();
    if (answers.has(normalizedAnswer)) errors.push(`答案重复：${item.answer}`);
    answers.add(normalizedAnswer);
    const actualLength = Array.from(item.answer).length;
    if (item.length !== actualLength) errors.push(`${item.id} 的字数不正确。`);
    if (actualLength < 2 || actualLength > 4) errors.push(`${item.id} 的答案应为 2～4 个汉字。`);
    if (item.hotHint.normalize('NFKC').trim() === normalizedAnswer) {
      errors.push(`${item.id} 的高关联提示不能等于答案。`);
    }
    if (!item.testVector.length || item.testVector.some((value) => !Number.isFinite(value))) {
      errors.push(`${item.id} 的测试向量无效。`);
    }
  }
  if (categories.size !== GAME_CATEGORIES.length) errors.push(`题库需要完整覆盖 ${GAME_CATEGORIES.length} 个分类。`);
  for (const category of GAME_CATEGORIES) {
    if (questions.filter((item) => item.category === category).length < 25) {
      errors.push(`${category}分类至少需要 25 道题。`);
    }
  }
  return errors;
}

export function getQuestionById(id: string): Question | undefined {
  return QUESTIONS.find((item) => item.id === id && item.active);
}

export function selectRandomQuestion(
  category?: GameCategory,
  randomValue: number = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
): Question {
  const active = QUESTIONS.filter((item) => item.active && (!category || item.category === category));
  if (active.length === 0) throw new Error('No active questions are configured.');
  const index = Math.min(active.length - 1, Math.floor(Math.max(0, randomValue) * active.length));
  return active[index];
}

export function selectDailyQuestion(date: string): Question {
  const active = QUESTIONS.filter((item) => item.active);
  let hash = 2166136261;
  for (const character of date) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return active[(hash >>> 0) % active.length];
}

export function deterministicVectorForText(text: string, target: Question): readonly number[] {
  if (text === target.hotHint) {
    return target.testVector.map((value, index) => value + (index === target.testVector.length - 1 ? 0.03 : 0));
  }
  const matchingQuestion = QUESTIONS.find(
    (item) => item.answer === text || item.hotHint === text,
  );
  if (matchingQuestion) return matchingQuestion.testVector;

  const categoryIndex = GAME_CATEGORIES.indexOf(text as GameCategory);
  if (categoryIndex >= 0) return vector(categoryIndex, 0, 0);

  const semanticLexicon: Record<string, readonly number[]> = {
    生物: vector(0, 0, 0),
    鸟类: vector(0, -0.75, 0.75),
    海豹: vector(0, -0.8, 0.75),
    水果: vector(1, 0.55, 0.35),
    美食: vector(1, 0, 0.45),
    工作: vector(2, 0, 0),
    救援: vector(2, 0.75, -0.4),
    天气: vector(3, 0, 0.35),
    光线: vector(3, 0.25, -0.4),
    情感: vector(4, 0.2, 0.4),
    精神: vector(4, 0.45, 0),
    工具: vector(5, 0, 0.35),
    家电: vector(5, -0.4, 0.25),
    古人: vector(6, 0, 0.2),
    皇帝: vector(6, 0.7, -0.2),
    运动员: vector(7, 0.4, 0.2),
    冠军: vector(7, 0.6, 0.4),
    银行: vector(2, -0.7, 0.1),
    汽车: vector(5, 0.1, -0.7),
  };
  const explicitVector = semanticLexicon[text];
  if (explicitVector) return explicitVector;

  const inferredCategory = CATEGORY_KEYWORDS.findIndex((keywords) =>
    keywords.some((keyword) => text.includes(keyword)),
  );
  if (inferredCategory >= 0) {
    return vector(
      inferredCategory,
      stableNoise(text, 101) * 0.18,
      stableNoise(text, 211) * 0.18,
    );
  }

  const fallback = hashedColdVector(text);
  const informativeClueCharacters = new Set(
    Array.from(`${target.answer}${target.subcategory}${target.hotHint}`).filter(
      (character) =>
        !CLUE_STOP_CHARACTERS.has(character) &&
        (CLUE_CHARACTER_FREQUENCY.get(character) ?? Number.POSITIVE_INFINITY) <= 3,
    ),
  );
  const guessCharacters = new Set(Array.from(text));
  const sharedCharacterCount = [...guessCharacters].filter((character) =>
    informativeClueCharacters.has(character),
  ).length;
  if (sharedCharacterCount === 0) return fallback;

  const overlap = sharedCharacterCount / guessCharacters.size;
  const targetWeight = Math.min(0.82, 0.32 + overlap * 0.5);
  return fallback.map(
    (value, index) => value * (1 - targetWeight) + target.testVector[index] * targetWeight,
  );
}

const CATEGORY_KEYWORDS: readonly (readonly string[])[] = [
  ['动物', '生物', '哺乳', '鸟', '禽', '昆虫', '鱼类', '宠物', '野兽', '爬虫'],
  ['食物', '食品', '水果', '蔬菜', '主食', '甜点', '饮料', '美食', '料理', '零食', '面食'],
  ['职业', '工作', '岗位', '行业', '员工', '上班', '专家', '从业者'],
  ['自然', '天气', '气象', '风雨', '雷电', '云层', '天空', '山川', '海洋'],
  ['概念', '情感', '品质', '思想', '心理', '精神', '感觉', '观念'],
  ['物品', '用品', '工具', '家电', '设备', '家具', '器具', '东西'],
  ['历史', '古代', '古人', '皇帝', '将军', '诗人', '思想家', '名人'],
  ['体育', '运动', '比赛', '冠军', '球员', '教练', '奥运', '体坛'],
] as const;

const CLUE_STOP_CHARACTERS = new Set(
  Array.from('的一是在和与为由用中于会可等个里上下内外生活地区常见进行形成发生负责提供面对保持状态能力结果长期之间'),
);

const CLUE_CHARACTER_FREQUENCY = QUESTIONS.reduce((frequencies, questionItem) => {
  const characters = new Set(
    Array.from(`${questionItem.answer}${questionItem.subcategory}${questionItem.hotHint}`),
  );
  for (const character of characters) {
    frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  }
  return frequencies;
}, new Map<string, number>());

const COLD_VECTOR_BASE = [-0.35, -0.25, -0.3, -0.2, -0.28, -0.32, -0.27, -0.3, 0.1, -0.1] as const;

function hashedColdVector(text: string): readonly number[] {
  // Development/test only: stable jitter prevents every unregistered word
  // from sharing one score. It is deliberately kept cold and is not semantic.
  return COLD_VECTOR_BASE.map((value, index) => value + stableNoise(text, index + 1) * 0.11);
}

function stableNoise(text: string, salt: number): number {
  let hash = (0x811c9dc5 ^ salt) >>> 0;
  for (const character of text) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  return (hash / 0xffffffff) * 2 - 1;
}
