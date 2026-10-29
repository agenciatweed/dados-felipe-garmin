# Garmin pessoal · Tweed

Dashboard de atividades e rotina. Python coleta os dados de forma gradual no computador; a interface lê os arquivos salvos. O código é público. Dados de saúde, localização, arquivos originais e credenciais ficam fora deste repositório, somente no armazenamento local. A rotina não usa mais Vercel ou Blob.

## Executar localmente

Nesta instalação, dê dois cliques em `H:\Garmin\abrir-dashboard.cmd`. Ele inicia o servidor em segundo plano e abre o painel no navegador, como o Estúdio Editorial. Fechar a aba não encerra o servidor; abrir novamente reutiliza o servidor existente.

O servidor inicia automaticamente ao entrar no Windows, sem abrir o navegador. Acesse http://127.0.0.1:8791 quando quiser. O atalho de inicialização pode ser reinstalado com `instalar-inicializacao.ps1`.

Requer Python 3.12+.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r dashboard\requirements.txt
.\iniciar-dashboard.ps1
```

Abra http://127.0.0.1:8791. O painel não acessa a Garmin. Para coletar, crie `api.md` na raiz contendo somente sua chave pessoal e execute:

```powershell
.\.venv\Scripts\python.exe dashboard\collector.py --plan
.\.venv\Scripts\python.exe dashboard\collector.py --once
```

## Coleta gradual

- Histórico desde 01/10/2025, até um mês por execução a cada 30 minutos.
- Chamadas sequenciais, com intervalo mínimo de oito segundos e variação de até dois segundos.
- Limite inicial de 300 chamadas ou 25 minutos por execução. Um mês grande pode continuar na próxima execução, sem perder o progresso.
- HTTP 429 e falhas de servidor interrompem a coleta e respeitam `Retry-After`, quando informado, mais o intervalo de segurança configurado. Essas configurações são precauções locais, não uma quota oficial garantida pela Garmin.
- Checkpoints em SQLite, bloqueio de execuções concorrentes e arquivos JSON/ZIP em `dados_locais`.
- Concluído o histórico, a cada 12 horas atualiza as datas tocadas pelas últimas 48 horas, com sobreposição de dias porque a API usa datas de calendário. Recupera intervalos pendentes se o computador ficar sem conexão ou execução.
- Erros individuais não são apresentados como dias sem dados. Após três falhas não transitórias, a consulta fica registrada como indisponível e o restante pode continuar.

Configuração: `dashboard/sync-config.json`. Estado: `collector.py --status`. Pausar: `collector.py --pause`. Retomar: `collector.py --resume` (preserva pausas impostas pelo limite de API).

## Recursos ativos

Atividades, detalhes, treinos associados, arquivo original, zonas cardíacas, sono diário e histórico, Body Battery, estresse, frequência cardíaca, passos, resumos diários e perfil. HRV, peso, composição corporal, hidratação, alimentação, SpO₂, idade de condicionamento, metas de peso, atividades de bem-estar e ciclo menstrual foram excluídos do painel e das consultas agendadas por escolha do usuário. Arquivos anteriormente existentes não são apagados.

## Publicação e privacidade

O painel funciona em `http://127.0.0.1:8791`, com servidor Python local e sem build. Lê os dados de `dados_locais` diretamente; não depende de armazenamento, funções ou deploys da Vercel. Os arquivos antigos de integração com a nuvem estão preservados, mas não são executados pela rotina.

`run_pipeline.py` executa coleta local e backup apenas do código no Git. `publish_public.py` usa uma lista explícita de arquivos, verifica credenciais acidentais e nunca adiciona dados de saúde. Sem alterações de código, não cria commits vazios. O bloqueio `.publication-hold` continua sendo respeitado.

A tarefa do Codex roda a cada 12 horas. Requer o computador ligado, o Codex aberto e internet para a coleta; o navegador pode estar fechado. Abrir o painel não dispara consultas à Garmin. A janela de 48 horas e a recuperação de períodos pendentes estão preservadas.

O endereço local funciona neste computador. A versão antiga da Vercel deixa de receber atualizações; os dados e as credenciais que já existem lá não são apagados por esta migração. Dados pessoais não vão ao Git público.

## Explorar os gráficos

O volume semanal alterna entre distância e tempo com transição suave. Passe o cursor, toque no gráfico ou use as setas, Home e End para selecionar um ponto. Os valores aparecem abaixo do gráfico; em ritmo por corrida, “Ver treino” abre os detalhes da atividade selecionada. A preferência do sistema por movimento reduzido desativa a transição. Essas interações usam somente os dados já salvos, sem consultar a Garmin.

## Identidade visual

Design system [Agência Tweed](https://github.com/agenciatweed/brand-guidelines-tweed): azul-escuro `#0b0c13`, teal `#08ffb1`, branco e tipografia Inter. Assets oficiais são baixados de um commit fixo no build; origens em `dashboard/assets/ORIGINS.json`.

## Verificação

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s dashboard -p test_collector.py -v
node --check dashboard\app.js
npm install
npm run build
```

Os testes usam dados sintéticos e não acessam sua conta Garmin.

## Corridas e evolução

A seção `#corridas` adapta os cartões e gráficos mensais do Painel Infos Felipe. Mostra apenas corridas ao ar livre, com distância, pace e frequência cardíaca. A evolução reúne distância total, média por treino, pace ponderado pela distância e FC ponderada pela duração. O seletor oferece 6 meses, 12 meses e todo o histórico; meses incompletos e lacunas continuam explícitos. A seção Treinos mantém sua análise anterior.

Os dados vêm dos arquivos locais atuais e do histórico legado, unidos por ID sem duplicação. Recarregar dados apenas relê o disco. Os FIT são lidos sob demanda ao abrir uma corrida; o percurso é sobreposto ao Google Maps ao abrir a corrida. A chave de navegador fica em tokens/google-maps.json, fora do Git; o mapa requer internet. Se o Google Maps falhar, o traçado local continua disponível. A dependência `fitdecode` está fixada em `dashboard/requirements.txt`.
