# Privacy policy

*Effective 2 November 2026. Applies to the Lepidox browser extension for Chrome and Microsoft Edge.*

Lepidox is developed and published by Adriel Teles, an individual developer. It rotates a list of web pages in browser tabs, and it does that entirely inside your browser.

## What Lepidox does with your data

It stores the following on your device, in the extension's own browser storage:

| Data | Purpose | Kept until |
| --- | --- | --- |
| Your lists: list names, screen names, addresses (URLs), durations and options | To rotate the screens you configured | You delete the list or remove the extension |
| The page title and last known status (loaded, sign-in required, failed, with the browser's error code) of each screen | To name screens automatically and show which ones need attention | The screen is deleted or the extension is removed |
| The state of a running rotation, including the identifiers of the tabs it manages | To rotate, and to recover after the browser suspends the extension | The rotation stops or the browser closes |
| Which list was running, at which screen, and the position and address of the tabs it managed | To carry the rotation on after an extension update, and to resume lists set to resume when the browser starts | You stop the rotation |

To do this it reads the **title and address of browser tabs**:

- of the tabs it opens for your screens, to name them and to notice a redirect to a sign-in page;
- of the tabs the browser restores when it starts, to reuse the ones it had opened for your screens instead of opening them again;
- of your open tabs, at the moment you choose *Create list from open tabs* or *Add open tabs*, to offer them as screens.

It also learns from the browser when a page in one of its own tabs fails to load, and the error code. The browser reports page loads in other tabs as well; Lepidox ignores them and keeps nothing about them.

Exporting your lists creates a file on your device, only when you ask for it.

## What Lepidox does not do

- It does not collect, transmit, sell or share any data. Nothing listed above leaves your device.
- It does not have an account system, a server, analytics or advertising.
- It does not sync your lists between devices.
- It does not read the content of any page.
- It does not access cookies, passwords or form data, and it does not record your browsing history.
- It does not sign in on your behalf and does not store credentials. The screens it opens are ordinary tabs in your browser profile and use the sessions you already have.
- It does not change how the sites you open handle your data. Each site keeps applying its own privacy policy.

## Browser permissions

- `tabs`: open, switch, reuse and close the tabs that show your screens, and read their title and address as described above.
- `storage`: keep the data listed above on your device.
- `alarms`: wake the extension when it is time to rotate.
- `webNavigation`: learn that a page in one of its tabs failed to load, as described above.
- `power`: keep the display on while a list set to do so is running.

Lepidox requests no access to the content of websites (no host permissions).

## Removing your data

Delete a list in the options page to remove it and everything stored about its screens. Removing the extension deletes all of its data.

## Changes and contact

Changes to this policy are published in this file, with a new effective date. Questions and requests: open an issue at <https://github.com/AdrielGTeles/lepidox/issues>.

---

# Política de privacidade

*Em vigor desde 2 de novembro de 2026. Aplica-se à extensão Lepidox para Chrome e Microsoft Edge.*

O Lepidox é desenvolvido e publicado por Adriel Teles, desenvolvedor individual. Ele alterna uma lista de páginas da web em abas do navegador, e faz isso inteiramente dentro do seu navegador.

## O que o Lepidox faz com os seus dados

Ele guarda o seguinte no seu dispositivo, no armazenamento da própria extensão:

| Dado | Finalidade | Guardado até |
| --- | --- | --- |
| Suas listas: nomes das listas e das telas, endereços (URLs), tempos e opções | Alternar as telas que você configurou | Você excluir a lista ou remover a extensão |
| O título da página e o último estado conhecido (carregada, login necessário, falhou, com o código de erro do navegador) de cada tela | Nomear telas automaticamente e mostrar quais precisam de atenção | A tela ser excluída ou a extensão removida |
| O estado de uma rotação em andamento, incluindo os identificadores das abas que ela gerencia | Alternar as telas e se recuperar quando o navegador suspende a extensão | A rotação ser encerrada ou o navegador fechado |
| Qual lista estava em rotação, em qual tela, e a posição e o endereço das abas que ela gerenciava | Continuar a rotação depois de uma atualização da extensão e retomar listas configuradas para voltar ao abrir o navegador | Você encerrar a rotação |

Para isso, ele lê o **título e o endereço de abas do navegador**:

- das abas que ele abre para as suas telas, para nomeá-las e perceber um redirecionamento para uma página de login;
- das abas que o navegador restaura ao abrir, para reaproveitar as que ele tinha aberto para as suas telas em vez de abri-las de novo;
- das suas abas abertas, no momento em que você escolhe *Criar lista com as abas abertas* ou *Adicionar abas abertas*, para oferecê-las como telas.

Ele também fica sabendo, pelo navegador, quando uma página em uma das abas dele não carrega, e o código do erro. O navegador informa os carregamentos das outras abas também; o Lepidox os ignora e não guarda nada sobre eles.

Exportar suas listas cria um arquivo no seu dispositivo, apenas quando você pede.

## O que o Lepidox não faz

- Não coleta, transmite, vende nem compartilha nenhum dado. Nada do que está listado acima sai do seu dispositivo.
- Não tem sistema de contas, servidor, análise de uso ou publicidade.
- Não sincroniza suas listas entre dispositivos.
- Não lê o conteúdo de nenhuma página.
- Não acessa cookies, senhas ou dados de formulários e não registra o seu histórico de navegação.
- Não faz login por você e não guarda credenciais. As telas que ele abre são abas comuns do seu perfil do navegador e usam as sessões que você já tem.
- Não altera a forma como os sites que você abre tratam os seus dados. Cada site continua aplicando a própria política de privacidade.

## Permissões do navegador

- `tabs`: abrir, alternar, reaproveitar e fechar as abas que exibem suas telas, e ler título e endereço como descrito acima.
- `storage`: guardar no seu dispositivo os dados listados acima.
- `alarms`: acordar a extensão na hora de alternar a tela.
- `webNavigation`: saber que uma página em uma das abas dele não carregou, como descrito acima.
- `power`: manter a tela ligada enquanto uma lista configurada para isso estiver em rotação.

O Lepidox não pede acesso ao conteúdo dos sites (não usa permissões de host).

## Como remover seus dados

Exclua uma lista na página de opções para remover a lista e tudo o que foi guardado sobre as telas dela. Remover a extensão apaga todos os dados.

## Alterações e contato

Alterações nesta política são publicadas neste arquivo, com nova data de vigência. Dúvidas e solicitações: abra uma issue em <https://github.com/AdrielGTeles/lepidox/issues>.
