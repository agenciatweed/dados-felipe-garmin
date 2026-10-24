# Garmin pessoal · Tweed

Dashboard de atividades e rotina. Python coleta os dados de forma gradual no computador; a interface lê os arquivos salvos. O código é público. Dados de saúde, localização, arquivos originais e credenciais ficam fora deste repositório, em armazenamento local e Vercel Blob privado.

## Executar localmente

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

- Histórico desde 01/10/2025, até um mês por execução horária.
- Chamadas sequenciais, com intervalo mínimo de oito segundos e variação de até dois segundos.
- Limite inicial de 300 chamadas ou 45 minutos por execução. Um mês grande pode continuar na hora seguinte, sem perder o progresso.
- HTTP 429 e falhas de servidor interrompem a coleta e respeitam `Retry-After`, quando informado, mais o intervalo de segurança configurado. Essas configurações são precauções locais, não uma quota oficial garantida pela Garmin.
- Checkpoints em SQLite, bloqueio de execuções concorrentes e arquivos JSON/ZIP em `dados_locais`.
- Concluído o histórico, atualiza as datas tocadas pelas últimas 24 horas, com sobreposição de dias porque a API usa datas de calendário. Recupera intervalos pendentes se o computador ficar sem conexão ou execução.
- Erros individuais não são apresentados como dias sem dados. Após três falhas não transitórias, a consulta fica registrada como indisponível e o restante pode continuar.

Configuração: `dashboard/sync-config.json`. Estado: `collector.py --status`. Pausar: `collector.py --pause`. Retomar: `collector.py --resume` (preserva pausas impostas pelo limite de API).

## Recursos ativos

Atividades, detalhes, treinos associados, arquivo original, zonas cardíacas, sono diário e histórico, Body Battery, estresse, frequência cardíaca, passos, resumos diários e perfil. HRV, peso, composição corporal, hidratação, alimentação, SpO₂, idade de condicionamento, metas de peso, atividades de bem-estar e ciclo menstrual foram excluídos do painel e das consultas agendadas por escolha do usuário. Arquivos anteriormente existentes não são apagados.

## Publicação e privacidade

Vercel usa `api/cloud.mjs` para consultar arquivos mensais compactados em Blob privado. A aplicação publicada mantém Vercel Authentication ativada; o login da conta autorizada é necessário para ver os dados. Não desative essa proteção nem adicione domínios sem revisar a proteção correspondente.

`dashboard/sync_cloud.py` envia somente ao domínio Vercel configurado, usando credenciais locais fora do Git. A chave Garmin nunca vai para a nuvem. As credenciais de sincronização ficam em `tokens/cloud-sync.json`, excluídas da publicação. Variáveis do deployment: `BLOB_STORE_ID` e `GARMIN_SYNC_SECRET`.

`run_pipeline.py` executa coleta, sincronização privada e publicação de código. `publish_public.py` usa uma lista explícita de arquivos, verifica credenciais acidentais e nunca adiciona dados de saúde. Sem alterações de código, não cria commits vazios. Os dados mudam no armazenamento privado, sem exigir um novo deploy a cada coleta.

O agendamento horário é feito no Codex no computador do usuário. Requer o aplicativo aberto e acesso à internet; o serviço não coleta dados pela Vercel nem executa pulls ao abrir o painel.

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
