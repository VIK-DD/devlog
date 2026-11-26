# Devlog pentru Discord

Un bot Discord care publică activitatea GitHub într-un canal. Fiecare card are numele repository-ului, un link către GitHub, autorul și ora. Push-urile apar mov, cu link la comparație și la fiecare commit. Un push lung continuă pe mai multe carduri. Joburile și deploy-urile reușite apar în verde, erorile în roșu, iar execuțiile active în galben.

Feedul începe din momentul instalării. O singură GitHub App poate acoperi repository-urile publice și private la care a fost instalată, inclusiv cele create ulterior dacă alegi **All repositories**. Instaleaz-o în fiecare cont sau organizație pe care vrei s-o urmărești.

## Configurare

1. Creează un canal în Discord, de exemplu `#devlog`. Pentru repository-uri private, folosește un canal în care publicul are acces la acea activitate. Creează o aplicație în [Discord Developer Portal](https://discord.com/developers/applications). Din **Bot** obții tokenul. Din **Installation** activezi instalarea pe server cu scope-ul `bot`, apoi instalezi aplicația folosind linkul de instalare. În canal, botul are nevoie de **View Channel**, **Send Messages** și **Embed Links**. Activează **Developer Mode** în Discord, apoi folosește **Copy Channel ID** pe canal.
2. Alege adresa HTTPS publică a serviciului, de exemplu `https://devlog.exemplu.ro`. Pune un reverse proxy HTTPS în fața procesului Node sau folosește adresa HTTPS a platformei de hosting. Configurează proxy-ul pentru cereri de până la 25 MiB. Pe un host care rutează către container, setează și `HOST=0.0.0.0`.
3. Creează o [GitHub App](https://github.com/settings/apps/new) cu **Webhook** activ, URL `https://devlog.exemplu.ro/webhooks/github` și un secret generat local, de exemplu cu `openssl rand -hex 32`. Configurează permisiunile de repository de mai jos și selectează evenimentele aferente în **Subscribe to events**. Notează **App ID**, apoi generează o cheie privată în setările aplicației, pentru push-urile care depășesc limita payloadului.
4. Copiază `.env.example` în `.env`. Completează `GITHUB_WEBHOOK_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`, `GITHUB_APP_ID` și calea către fișierul cheii în `GITHUB_APP_PRIVATE_KEY_FILE`. Păstrează fișierul cheii și `.env` în afara versionării. Poți seta `GITHUB_LOGIN` ca să vezi numai evenimentele asociate utilizatorului tău. Dacă îl lași gol, vezi și activitatea colegilor și a roboților. Filtrul folosește identitățile din payload, inclusiv autorul unui commit atunci când GitHub furnizează username-ul.
5. Pornește botul cu Node.js 22.13 sau mai nou și `npm start`. Rulează o singură instanță pe un server permanent și păstrează `data/` pe un volum persistent. Verifică `GET /healthz`, apoi instalează GitHub App prin **Install App → All repositories** în conturile dorite. Pentru o organizație, instalarea poate necesita aprobarea administratorului. Pentru instalare și în alte conturi decât cel proprietar, GitHub App trebuie configurată să permită instalări în alte conturi.
6. Verifică **Advanced → Recent Deliveries** în GitHub App, apoi fă un push de test. GitHub ar trebui să primească HTTP 202, iar cardul să apară în canal. Poți rula `npm run preview` pentru trei exemple de mesaje Discord în JSON, cu date fictive.

| Permisiune GitHub App, doar citire | Evenimente |
| --- | --- |
| Contents | Push, Release, Create, Delete, Workflow dispatch, Commit comment |
| Actions | Workflow job, Workflow run |
| Pull requests | Pull request, Pull request review, Pull request review comment, Pull request review thread |
| Issues | Issues |
| Issues sau Pull requests | Issue comment |
| Deployments | Deployment, Deployment status |
| Discussions | Discussion, Discussion comment |
| Metadata | Repository, Fork, Star, Watch |
| Checks / Commit statuses | Check run, Check suite / Status |

**Workflow job** arată fiecare job, iar **Workflow run** actualizarea workflow-ului complet. Dacă le activezi pe ambele, canalul afișează ambele niveluri. **Create** și **Delete** pot apărea și într-un **Push** pentru același branch sau tag. Poți activa și alte evenimente disponibile pentru GitHub App. Pentru un eveniment cu repository și fără format dedicat, botul afișează evenimentul, acțiunea și linkul spre repository. [Referința evenimentelor și permisiunilor GitHub](https://docs.github.com/en/webhooks/webhook-events-and-payloads)

## Livrare și limite

- Botul verifică semnătura GitHub și scrie evenimentul în SQLite înainte să confirme primirea. Retrimite automat mesajele acceptate local când Discord e indisponibil și păstrează progresul fiecărui push împărțit în mai multe mesaje. Identificatorii livrărilor finalizate se păstrează șapte zile pentru deduplicare.
- Pentru un push foarte mare, botul încearcă să completeze lista prin API-ul GitHub. Când comparația nu este disponibilă, cardul include commit-urile primite, marchează lista ca parțială și oferă link la GitHub. GitHub poate omite complet un webhook, de exemplu pentru un push care actualizează peste 5.000 de branch-uri sau peste trei tag-uri simultan. [Limitele webhookurilor GitHub](https://docs.github.com/en/webhooks/webhook-events-and-payloads#push)
- Dacă serverul e oprit înainte să accepte un webhook, folosește **Redeliver** din **Recent Deliveries**. GitHub păstrează acolo livrările din ultimele trei zile. [Retrimiterea unui webhook](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks)

## Instalarea de pe Oracle VM

Devlog folosește serviciul `devlog.service`, portul local `8310`, baza de date din `/var/lib/devlog` și un tunel Cloudflare dedicat pentru `https://devlog.novaguard.fun/webhooks/github`. Codul și utilitarul de configurare sunt în `/opt/devlog`.

1. Pe Mac, copiază secretul webhookului cu `ssh oracle 'sudo -n /opt/devlog/configure secret' | pbcopy`. Lipește-l în câmpul **Secret** din registrarea GitHub App. Salvează aplicația, notează **App ID** și descarcă cheia PEM de la **Private keys → Generate a private key**.
2. În Discord Developer Portal, creează aplicația, instaleaz-o pe server și acordă botului **View Channel**, **Send Messages** și **Embed Links** în canalul privat. Copiază tokenul din secțiunea **Bot**.
3. În Terminal, încarcă fișierul cu `ssh oracle 'sudo -n /opt/devlog/configure key' < "/cale/către/cheia-github.pem"`. Rulează apoi `ssh -t oracle 'sudo -n /opt/devlog/configure discord VIK-DD 1520796164658565230'`. Utilitarul cere App ID și tokenul Discord, cu tokenul ascuns la tastare.
4. Pornește serviciul cu `ssh oracle 'sudo -n systemctl restart devlog.service'`. După ce `https://devlog.novaguard.fun/healthz` răspunde cu `ok`, instalează aplicația GitHub pe cont folosind **All repositories**.
