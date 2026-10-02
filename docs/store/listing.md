# Store listing

Texts to paste into the Chrome Web Store and Microsoft Edge Add-ons dashboards. The name and the short description come from the package (`_locales/*/messages.json`); everything else is typed into the dashboard.

Images are in [`store/`](../../store); [publishing.md](publishing.md#2-imagens-qual-arquivo-vai-em-cada-campo) says which file goes in each dashboard field.

The listing says what Lepidox does, in short sentences. What it does not do, and how it handles data, is explained in the [README](../../README.md) and in the [privacy policy](../../PRIVACY.md).

## English (default)

**Name** (from the package): Lepidox – Dashboard Rotator

**Short description** (from the package, 132 characters max):
Rotates your dashboards on a timer. For wall screens, war rooms and NOCs.

**Description**

```text
Lepidox rotates your dashboards on a timer.

Add your dashboards to a list, set the time and press Start. Lepidox shows one screen after the other and loads the next one in advance, so every switch is instant.

• Create a list from your open tabs, or paste the addresses.
• One time for the whole list, or a time for each screen.
• Pause to investigate and jump to any screen.
• Edit the list while it is running.
• See which screens need a sign-in or failed to load.
• Pause, next, previous and stop from the keyboard.
• Import and export your lists.

Your lists stay in your browser.

Open source: https://github.com/AdrielGTeles/lepidox
English and Brazilian Portuguese.
```

**Screenshot captions**

1. Your dashboards, on rotation. The next one is already loaded.
2. Build a list from open tabs, or paste the addresses.
3. Pause to investigate and jump to any screen.

## Português (Brasil)

**Nome** (vem do pacote): Lepidox – Rotação de Dashboards

**Descrição curta** (vem do pacote, máximo de 132 caracteres):
Alterna seus dashboards automaticamente. Para telões, salas de crise e NOCs.

**Descrição**

```text
O Lepidox alterna seus dashboards automaticamente.

Coloque seus dashboards em uma lista, defina o tempo e clique em Iniciar. O Lepidox exibe uma tela após a outra e carrega a próxima com antecedência, então cada troca é imediata.

• Crie a lista com as abas abertas ou cole os endereços.
• Um tempo para a lista inteira ou um tempo por tela.
• Pause para investigar e pule para qualquer tela.
• Edite a lista com a rotação em andamento.
• Veja quais telas pedem login ou não carregaram.
• Pause, avance, volte e encerre pelo teclado.
• Importe e exporte suas listas.

Suas listas ficam no seu navegador.

Código aberto: https://github.com/AdrielGTeles/lepidox
Português do Brasil e inglês.
```

**Legendas das capturas**

1. Seus dashboards, em rotação. O próximo já está carregado.
2. Monte a lista com as abas abertas ou cole os endereços.
3. Pause para investigar e pule para qualquer tela.

## Common fields

| Field | Value |
| --- | --- |
| Category (Chrome) | Tools. Alternative: Developer Tools |
| Category (Edge) | Productivity |
| Languages | English, Portuguese (Brazil) |
| Website | https://github.com/AdrielGTeles/lepidox |
| Support | https://github.com/AdrielGTeles/lepidox/issues |
| Privacy policy | https://github.com/AdrielGTeles/lepidox/blob/main/PRIVACY.md |
| Search terms (Edge, up to 7) | dashboard rotator, tab rotation, wallboard, NOC, kiosk, Grafana, monitoring |
| Mature content | No |

## Privacy and permission declarations (Chrome Web Store, "Privacy practices" tab)

**Single purpose**

```text
Lepidox rotates a user-defined list of web pages (dashboards) in browser tabs on a timer, for display on monitoring screens.
```

**Permission justifications**

`tabs`
```text
Lepidox's single purpose is to show the user's dashboards in tabs, one after the other. It needs the tabs permission to open those tabs, switch between them on a timer, reuse a tab for the next dashboard and close them when the rotation stops. It reads the title and URL of the tabs it manages to name each screen after its page title and to detect that a dashboard was redirected to a sign-in page. When the user clicks "Create list from open tabs", it reads the title and URL of the open tabs to offer them as screens. This information is stored only in the browser and is never transmitted.
```

`storage`
```text
Stores the lists the user creates (names, URLs, durations) and the state of the running rotation, locally in the browser. Nothing is synced or sent to a server.
```

`alarms`
```text
Wakes the extension's service worker when it is time to show the next dashboard. Rotation intervals of 30 seconds or more rely on an alarm, and shorter intervals use one as a fallback if the service worker is suspended.
```

**Host permissions**: none requested.

**Remote code**: No, the extension does not use remote code. Every script is included in the package.

**Data usage**: Lepidox does not collect or transmit user data; leave every data category unticked. The URLs and page titles it handles are stored only on the user's device. Tick the three certifications (no sale of data, no use unrelated to the single purpose, no use for creditworthiness or lending).

## Notes for reviewers (Chrome "Test instructions", Edge "Notes for certification")

```text
No account or sign-in is needed.

1. Open two or more ordinary web pages in tabs (for example https://example.com and https://www.wikipedia.org).
2. Click the Lepidox toolbar icon and choose "Create list from open tabs".
3. Click "Start". Lepidox opens the pages in new tabs and switches between them every 30 seconds.
4. Use the popup to pause, go to the next or previous screen, or stop. Stopping closes the tabs Lepidox opened.
5. "Manage lists" opens the options page, where lists and timings are edited.

The tabs permission is used only to open and switch the tabs above and to read their title and URL. The extension makes no network requests of its own and has no host permissions or content scripts.
```
