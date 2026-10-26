# OTTO

Assistente pessoal no arquivo **otto.html**, com agenda, central de e-mails, radar de notícias e Morning Digest. O HTML abre diretamente no navegador; **server.js** é a antena local para fontes que precisam de CORS e IMAP.

## Iniciar

1. Abra um terminal nesta pasta, rode **node server.js** e deixe o terminal aberto.
2. Abra **otto.html** com dois cliques no Chrome. A chave da Anthropic e as notas do Second Brain continuam no armazenamento local já usado pelo OTTO.
3. Clique em **ATIVAR SISTEMA** e permita o microfone.
4. Abra **⚙ Configurações** para adicionar os links iCal e a conta Gmail.

## Configurar agenda

No Google Agenda pelo computador, abra **⚙ Configurações**, escolha a agenda na lista à esquerda, entre em **Integrar agenda** e copie o **Endereço secreto em formato iCal**. Cole o link no campo correspondente no OTTO. O link fica no navegador e não é enviado à IA.

## Configurar Gmail

1. Ative a verificação em duas etapas em myaccount.google.com/security.
2. Depois, acesse myaccount.google.com/apppasswords, crie uma senha de app chamada **Jarvis** e copie as 16 letras.
3. No OTTO, cole seu e-mail e essa senha de app. Não use a senha normal da conta.

O OTTO consulta e-mails em modo somente leitura. Para a triagem, remetente, assunto e um trecho podem ser enviados à Anthropic; a senha de app não é enviada à IA.

## Comandos de voz

Diga **“Olá OTTO”**, aguarde a resposta e então fale um comando:

- “Minha agenda” / “O que eu tenho hoje”
- “Próximo compromisso” / “Próxima reunião”
- “Agenda da semana”
- “Meus e-mails” / “Tem e-mail importante?”
- “Notícias” / “Notícias de tecnologia”
- “Bom dia”
- “Atualizar e-mails” / “Atualizar notícias”

O painel **DIGEST** também tem um botão para gerar o briefing. O digest usa Naviraí, MS para a previsão do tempo e fala em volume médio por padrão.
