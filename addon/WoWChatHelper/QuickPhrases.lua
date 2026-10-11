-- WoWChatHelper quick phrases (/wch say, /wch q; UI.OpenQuick): short English lines
-- that US-realm players really type, by situation, each with its meaning in the
-- player's language. A click only puts the English into the chat box; the player
-- presses Enter to send (the addon never sends chat).
--
-- WCH_QuickPhrases = { categories = { { key, title = { <lang> = text }, phrases = {
--   { en, tr = { <lang> = text } } } } } }, every title and tr in all 9 languages
-- (tests/addon_quickphrases_test.js checks it). zhTW is written for Taiwanese players;
-- the other eight are AI-written and not reviewed by native speakers.

WCH_QuickPhrases = {
	categories = {
		{
			key = "greet",
			title = { zhTW = "打招呼", zhCN = "打招呼", koKR = "인사", deDE = "Begrüßen", frFR = "Saluer", esES = "Saludar", ptBR = "Cumprimentar", ruRU = "Приветствие", itIT = "Saluti" },
			phrases = {
				{ en = "hey o/",
					tr = { zhTW = "嗨～（揮手）", zhCN = "嗨～（挥手）", koKR = "안녕~ (손 흔들기)", deDE = "hey (winkt)", frFR = "salut (fait coucou)", esES = "hola (saluda)", ptBR = "oi (acenando)", ruRU = "привет (машет рукой)", itIT = "ciao (saluta con la mano)" } },
				{ en = "hi all",
					tr = { zhTW = "大家好", zhCN = "大家好", koKR = "다들 안녕", deDE = "hallo zusammen", frFR = "salut tout le monde", esES = "hola a todos", ptBR = "oi, pessoal", ruRU = "всем привет", itIT = "ciao a tutti" } },
				{ en = "hey, how's it going?",
					tr = { zhTW = "嗨，最近還好嗎？", zhCN = "嗨，最近怎么样？", koKR = "안녕, 잘 지내?", deDE = "hey, wie läuft's?", frFR = "salut, ça va ?", esES = "hola, ¿qué tal?", ptBR = "oi, tudo bem?", ruRU = "привет, как дела?", itIT = "ciao, come va?" } },
				{ en = "hey, mind if i tag along?",
					tr = { zhTW = "嗨，介意我跟你們一起嗎？", zhCN = "嗨，介意我跟你们一起吗？", koKR = "안녕, 같이 다녀도 될까?", deDE = "hey, darf ich mitkommen?", frFR = "salut, ça vous dérange si je vous suis ?", esES = "hola, ¿os importa si me uno?", ptBR = "oi, posso ir junto?", ruRU = "привет, можно с вами?", itIT = "ciao, posso unirmi a voi?" } },
				{ en = "sorry, english isn't my first language",
					tr = { zhTW = "抱歉，英文不是我的母語", zhCN = "抱歉，英语不是我的母语", koKR = "미안, 영어가 모국어가 아니야", deDE = "sorry, Englisch ist nicht meine Muttersprache", frFR = "désolé, l'anglais n'est pas ma langue maternelle", esES = "perdón, el inglés no es mi lengua materna", ptBR = "desculpa, inglês não é minha língua nativa", ruRU = "извини, английский не мой родной язык", itIT = "scusa, l'inglese non è la mia lingua madre" } },
				{ en = "inv pls",
					tr = { zhTW = "請邀我", zhCN = "请邀请我", koKR = "초대해 줘", deDE = "lad mich bitte ein", frFR = "invite stp", esES = "invita, por favor", ptBR = "me convida, por favor", ruRU = "пригласи, пожалуйста", itIT = "invitami per favore" } },
			},
		},
		{
			key = "group",
			title = { zhTW = "剛進隊伍", zhCN = "刚进队伍", koKR = "파티 합류", deDE = "Neu in der Gruppe", frFR = "Arrivée dans le groupe", esES = "Al entrar al grupo", ptBR = "Ao entrar no grupo", ruRU = "В группе", itIT = "Appena in gruppo" },
			phrases = {
				{ en = "hi all, ty for the inv",
					tr = { zhTW = "大家好，謝謝邀請", zhCN = "大家好，谢谢邀请", koKR = "다들 안녕, 초대 고마워", deDE = "hallo zusammen, danke für die Einladung", frFR = "salut à tous, merci pour l'invit", esES = "hola a todos, gracias por la invitación", ptBR = "oi pessoal, valeu pelo convite", ruRU = "всем привет, спасибо за приглашение", itIT = "ciao a tutti, grazie per l'invito" } },
				{ en = "first time in this dungeon, any tips?",
					tr = { zhTW = "第一次打這個副本，有什麼要注意的嗎？", zhCN = "第一次打这个副本，有什么要注意的吗？", koKR = "이 던전 처음인데, 팁 있어?", deDE = "zum ersten Mal in diesem Dungeon, irgendwelche Tipps?", frFR = "première fois dans ce donjon, des conseils ?", esES = "primera vez en esta mazmorra, ¿algún consejo?", ptBR = "primeira vez nessa masmorra, alguma dica?", ruRU = "впервые в этом подземелье, есть советы?", itIT = "prima volta in questo dungeon, qualche consiglio?" } },
				{ en = "ready when u are",
					tr = { zhTW = "我準備好了，隨時可以", zhCN = "我准备好了，随时可以", koKR = "난 준비됐어, 언제든", deDE = "bin bereit, wenn ihr es seid", frFR = "prêt quand vous voulez", esES = "listo cuando queráis", ptBR = "pronto quando vocês estiverem", ruRU = "я готов, когда скажете", itIT = "pronto quando volete" } },
				{ en = "sec, gotta repair first",
					tr = { zhTW = "等一下，我先去修裝", zhCN = "等一下，我先去修装备", koKR = "잠깐, 수리 먼저 할게", deDE = "Moment, muss erst reparieren", frFR = "une seconde, je dois réparer d'abord", esES = "un momento, tengo que reparar primero", ptBR = "um segundo, preciso reparar antes", ruRU = "секунду, сначала починюсь", itIT = "un attimo, devo prima riparare" } },
				{ en = "what's the plan?",
					tr = { zhTW = "等下怎麼打？", zhCN = "等下怎么打？", koKR = "계획이 뭐야?", deDE = "was ist der Plan?", frFR = "c'est quoi le plan ?", esES = "¿cuál es el plan?", ptBR = "qual é o plano?", ruRU = "какой план?", itIT = "qual è il piano?" } },
				{ en = "new to the game, nice to meet u",
					tr = { zhTW = "我剛開始玩，很高興認識你", zhCN = "我刚开始玩，很高兴认识你", koKR = "게임 시작한 지 얼마 안 됐어, 만나서 반가워", deDE = "bin neu im Spiel, freut mich", frFR = "je débute dans le jeu, enchanté", esES = "soy nuevo en el juego, encantado", ptBR = "sou novo no jogo, prazer", ruRU = "я новичок в игре, рад знакомству", itIT = "sono nuovo del gioco, piacere" } },
			},
		},
		{
			key = "wait",
			title = { zhTW = "等一下／暫離", zhCN = "等一下／暂离", koKR = "잠깐 / 자리 비움", deDE = "Warten / AFK", frFR = "Attendre / AFK", esES = "Esperar / AFK", ptBR = "Esperar / AFK", ruRU = "Подождать / АФК", itIT = "Attesa / AFK" },
			phrases = {
				{ en = "brb 2 min",
					tr = { zhTW = "離開兩分鐘，馬上回來", zhCN = "离开两分钟，马上回来", koKR = "2분만, 금방 올게", deDE = "bin gleich zurück, 2 Min", frFR = "je reviens, 2 min", esES = "vuelvo en 2 min", ptBR = "já volto, 2 min", ruRU = "отойду на 2 минуты", itIT = "torno subito, 2 minuti" } },
				{ en = "afk 5, sorry",
					tr = { zhTW = "暫離五分鐘，抱歉", zhCN = "暂离五分钟，抱歉", koKR = "5분 자리 비울게, 미안", deDE = "5 Min afk, sorry", frFR = "afk 5 min, désolé", esES = "ausente 5 min, perdón", ptBR = "ausente 5 min, foi mal", ruRU = "отойду на 5 минут, извините", itIT = "assente 5 minuti, scusate" } },
				{ en = "1 sec",
					tr = { zhTW = "等我一下", zhCN = "等我一下", koKR = "잠깐만", deDE = "eine Sekunde", frFR = "une seconde", esES = "un segundo", ptBR = "um segundo", ruRU = "секунду", itIT = "un secondo" } },
				{ en = "omw",
					tr = { zhTW = "我在路上了", zhCN = "我在路上了", koKR = "가는 중", deDE = "bin unterwegs", frFR = "j'arrive", esES = "voy de camino", ptBR = "tô a caminho", ruRU = "уже иду", itIT = "sto arrivando" } },
				{ en = "np, take ur time",
					tr = { zhTW = "沒關係，慢慢來", zhCN = "没关系，慢慢来", koKR = "괜찮아, 천천히 해", deDE = "kein Problem, lass dir Zeit", frFR = "pas de souci, prends ton temps", esES = "no pasa nada, tómate tu tiempo", ptBR = "sem problema, sem pressa", ruRU = "без проблем, не торопись", itIT = "nessun problema, fai con calma" } },
				{ en = "back",
					tr = { zhTW = "我回來了", zhCN = "我回来了", koKR = "돌아왔어", deDE = "bin wieder da", frFR = "de retour", esES = "ya volví", ptBR = "voltei", ruRU = "я вернулся", itIT = "sono tornato" } },
			},
		},
		{
			key = "thanks",
			title = { zhTW = "道謝", zhCN = "道谢", koKR = "감사", deDE = "Danken", frFR = "Remercier", esES = "Agradecer", ptBR = "Agradecer", ruRU = "Благодарность", itIT = "Ringraziare" },
			phrases = {
				{ en = "ty!",
					tr = { zhTW = "謝謝！", zhCN = "谢谢！", koKR = "고마워!", deDE = "danke!", frFR = "merci !", esES = "¡gracias!", ptBR = "valeu!", ruRU = "спасибо!", itIT = "grazie!" } },
				{ en = "thx for the run",
					tr = { zhTW = "謝謝帶我打這趟", zhCN = "谢谢带我打这趟", koKR = "같이 돌아줘서 고마워", deDE = "danke für den Run", frFR = "merci pour le donjon", esES = "gracias por la run", ptBR = "valeu pela run", ruRU = "спасибо за забег", itIT = "grazie per la run" } },
				{ en = "ty for the help, appreciate it",
					tr = { zhTW = "謝謝幫忙，真的很感激", zhCN = "谢谢帮忙，真的很感激", koKR = "도와줘서 고마워, 정말 감사해", deDE = "danke für die Hilfe, weiß ich zu schätzen", frFR = "merci pour l'aide, c'est apprécié", esES = "gracias por la ayuda, lo agradezco", ptBR = "valeu pela ajuda, agradeço muito", ruRU = "спасибо за помощь, очень ценю", itIT = "grazie dell'aiuto, lo apprezzo" } },
				{ en = "gg all",
					tr = { zhTW = "大家打得好", zhCN = "大家打得好", koKR = "다들 수고했어", deDE = "gg an alle", frFR = "gg à tous", esES = "gg a todos", ptBR = "gg, pessoal", ruRU = "всем gg", itIT = "gg a tutti" } },
				{ en = "np",
					tr = { zhTW = "不客氣", zhCN = "不客气", koKR = "천만에", deDE = "kein Ding", frFR = "de rien", esES = "de nada", ptBR = "de nada", ruRU = "не за что", itIT = "figurati" } },
			},
		},
		{
			key = "leave",
			title = { zhTW = "離隊／下線", zhCN = "离队／下线", koKR = "떠나기 / 접속 종료", deDE = "Gehen / Ausloggen", frFR = "Partir / Se déconnecter", esES = "Irse / Desconectar", ptBR = "Sair / Deslogar", ruRU = "Уйти / Выйти", itIT = "Andare via / Uscire" },
			phrases = {
				{ en = "gtg, ty all",
					tr = { zhTW = "我得走了，謝謝大家", zhCN = "我得走了，谢谢大家", koKR = "이제 가야 해, 다들 고마워", deDE = "muss los, danke euch allen", frFR = "je dois y aller, merci à tous", esES = "me tengo que ir, gracias a todos", ptBR = "tenho que ir, valeu a todos", ruRU = "мне пора, всем спасибо", itIT = "devo andare, grazie a tutti" } },
				{ en = "gotta log, gn all",
					tr = { zhTW = "要下線了，大家晚安", zhCN = "要下线了，大家晚安", koKR = "이제 접속 종료할게, 다들 잘 자", deDE = "muss offline, gute Nacht allen", frFR = "je dois me déco, bonne nuit à tous", esES = "me desconecto, buenas noches a todos", ptBR = "vou sair, boa noite a todos", ruRU = "ухожу из игры, всем спокойной ночи", itIT = "devo staccare, buonanotte a tutti" } },
				{ en = "sorry, have to leave, gl",
					tr = { zhTW = "抱歉我得離開了，祝順利", zhCN = "抱歉我得离开了，祝顺利", koKR = "미안, 가봐야 해, 행운을 빌어", deDE = "sorry, muss weg, viel Glück", frFR = "désolé, je dois partir, bonne chance", esES = "perdón, me tengo que ir, suerte", ptBR = "desculpa, preciso sair, boa sorte", ruRU = "извините, мне нужно уйти, удачи", itIT = "scusate, devo andare, buona fortuna" } },
				{ en = "thx for the group, cya",
					tr = { zhTW = "謝謝這團，下次見", zhCN = "谢谢这个队伍，下次见", koKR = "파티 고마웠어, 또 봐", deDE = "danke für die Gruppe, bis dann", frFR = "merci pour le groupe, à plus", esES = "gracias por el grupo, nos vemos", ptBR = "valeu pelo grupo, até mais", ruRU = "спасибо за группу, до встречи", itIT = "grazie per il gruppo, ci vediamo" } },
				{ en = "cya around o/",
					tr = { zhTW = "之後見～ o/", zhCN = "有缘再见 o/", koKR = "또 보자 o/", deDE = "man sieht sich o/", frFR = "à la prochaine o/", esES = "nos vemos por ahí o/", ptBR = "até a próxima o/", ruRU = "ещё увидимся o/", itIT = "ci si vede in giro o/" } },
			},
		},
		{
			key = "trade",
			title = { zhTW = "交易", zhCN = "交易", koKR = "거래", deDE = "Handeln", frFR = "Commerce", esES = "Comercio", ptBR = "Comércio", ruRU = "Торговля", itIT = "Commercio" },
			phrases = {
				{ en = "how much?",
					tr = { zhTW = "多少錢？", zhCN = "多少钱？", koKR = "얼마야?", deDE = "wie viel?", frFR = "combien ?", esES = "¿cuánto?", ptBR = "quanto custa?", ruRU = "сколько?", itIT = "quanto costa?" } },
				{ en = "still selling?",
					tr = { zhTW = "還在賣嗎？", zhCN = "还在卖吗？", koKR = "아직 팔아?", deDE = "verkaufst du noch?", frFR = "tu vends toujours ?", esES = "¿todavía lo vendes?", ptBR = "ainda está vendendo?", ruRU = "ещё продаёшь?", itIT = "lo vendi ancora?" } },
				{ en = "can u go lower?",
					tr = { zhTW = "可以算便宜一點嗎？", zhCN = "可以便宜一点吗？", koKR = "조금 깎아 줄 수 있어?", deDE = "geht's etwas billiger?", frFR = "tu peux baisser un peu ?", esES = "¿me lo dejas un poco más barato?", ptBR = "faz um pouco mais barato?", ruRU = "можешь чуть дешевле?", itIT = "puoi farlo un po' più basso?" } },
				{ en = "deal",
					tr = { zhTW = "成交", zhCN = "成交", koKR = "좋아, 거래하자", deDE = "abgemacht", frFR = "marché conclu", esES = "trato hecho", ptBR = "fechado", ruRU = "договорились", itIT = "affare fatto" } },
				{ en = "no thx, too much for me",
					tr = { zhTW = "不用了謝謝，對我來說太貴了", zhCN = "不用了谢谢，对我来说太贵了", koKR = "괜찮아, 나한텐 너무 비싸", deDE = "nein danke, zu teuer für mich", frFR = "non merci, trop cher pour moi", esES = "no gracias, es demasiado para mí", ptBR = "não, valeu, caro demais pra mim", ruRU = "нет, спасибо, слишком дорого для меня", itIT = "no grazie, troppo per me" } },
				{ en = "sending trade",
					tr = { zhTW = "我開交易視窗給你了", zhCN = "我给你发交易了", koKR = "거래 신청 보낼게", deDE = "schicke dir einen Handel", frFR = "je t'envoie l'échange", esES = "te mando el comercio", ptBR = "mandando a troca", ruRU = "кидаю трейд", itIT = "ti mando lo scambio" } },
			},
		},
	},
}
